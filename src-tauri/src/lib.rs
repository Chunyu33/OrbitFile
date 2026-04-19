// OrbitFile - 专业的 Windows 存储重定向工具
// 后端 Rust 模块，提供系统扫描、磁盘信息、应用迁移和历史记录功能

mod app_manager;

use serde::{Deserialize, Serialize};
use sysinfo::Disks;
use std::path::{Path, PathBuf};
use std::fs;
use std::io::{Read, Write, Cursor};
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;
use std::sync::Mutex;

// Base64 编码，用于图标数据传输
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;

// 仅在 Windows 平台编译 symlink 相关代码
#[cfg(windows)]
use std::os::windows::fs::symlink_dir;

// Windows API 绑定，用于提取应用图标
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, GetIconInfo, ICONINFO,
};
#[cfg(windows)]
use windows::Win32::UI::Shell::ExtractIconExW;
#[cfg(windows)]
use windows::Win32::Graphics::Gdi::{
    GetDIBits, CreateCompatibleDC, DeleteDC, SelectObject, GetObjectW,
    BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject,
};
#[cfg(windows)]
use windows::core::PCWSTR;

// fs_extra 用于递归复制文件夹和移动文件夹
use fs_extra::dir::{copy, move_dir, CopyOptions, get_size};

// 图标缓存：使用 Mutex 保护的 HashMap 存储已提取的图标
// 键为图标路径，值为 Base64 编码的图标数据
lazy_static::lazy_static! {
    static ref ICON_CACHE: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
}

/// 已安装应用信息结构体
/// 包含从 Windows 注册表读取的应用基本信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstalledApp {
    /// 应用显示名称
    pub display_name: String,
    /// 安装位置路径
    pub install_location: String,
    /// 应用图标路径
    pub display_icon: String,
    /// 预估大小（KB）
    pub estimated_size: u64,
    /// 应用图标的 Base64 编码数据（PNG 格式）
    /// 如果提取失败则为空字符串
    pub icon_base64: String,
    /// 应用对应注册表路径（用于后续卸载）
    pub registry_path: String,
    /// 发布商（用于强力卸载残留匹配）
    pub publisher: String,
}

/// 从 EXE/DLL 文件中提取图标并转换为 Base64 编码的 PNG
/// 
/// # 技术实现说明
/// 使用 Windows Win32 API 提取图标：
/// 1. ExtractIconExW - 从可执行文件或 DLL 中提取图标句柄
/// 2. GetIconInfo - 获取图标的位图信息
/// 3. GetDIBits - 将位图转换为像素数据
/// 4. 使用 image crate 将像素数据编码为 PNG
/// 5. 使用 base64 crate 将 PNG 数据编码为 Base64 字符串
///
/// # 参数
/// - `icon_path`: 图标路径，可能包含索引（如 "C:\app.exe,0"）
///
/// # 返回
/// - 成功时返回 Base64 编码的 PNG 图标数据
/// - 失败时返回空字符串
#[cfg(windows)]
pub(crate) fn extract_icon_to_base64(icon_path: &str) -> String {
    // 检查缓存，避免重复提取
    if let Ok(cache) = ICON_CACHE.lock() {
        if let Some(cached) = cache.get(icon_path) {
            return cached.clone();
        }
    }

    // 解析图标路径和索引
    // 格式可能是 "C:\path\app.exe" 或 "C:\path\app.exe,0" 或 "C:\path\app.exe,-101"
    let (file_path, icon_index) = parse_icon_path(icon_path);
    
    // 检查文件是否存在
    if !Path::new(&file_path).exists() {
        return String::new();
    }

    // 将路径转换为宽字符串（Windows API 需要）
    let wide_path: Vec<u16> = file_path.encode_utf16().chain(std::iter::once(0)).collect();
    
    unsafe {
        // 用于存储提取的图标句柄
        let mut large_icon = windows::Win32::UI::WindowsAndMessaging::HICON::default();
        
        // 调用 ExtractIconExW 提取图标
        // 参数说明：
        // - lpszFile: 文件路径
        // - nIconIndex: 图标索引（负数表示资源 ID）
        // - phiconLarge: 大图标句柄输出
        // - phiconSmall: 小图标句柄输出（我们不需要）
        // - nIcons: 要提取的图标数量
        let result = ExtractIconExW(
            PCWSTR::from_raw(wide_path.as_ptr()),
            icon_index,
            Some(&mut large_icon),
            None,
            1,
        );

        // 检查是否成功提取图标
        if result == 0 || large_icon.is_invalid() {
            return String::new();
        }

        // 将图标转换为 Base64
        let base64_result = icon_to_base64(large_icon);
        
        // 销毁图标句柄，释放资源
        let _ = DestroyIcon(large_icon);

        // 缓存结果
        if !base64_result.is_empty() {
            if let Ok(mut cache) = ICON_CACHE.lock() {
                cache.insert(icon_path.to_string(), base64_result.clone());
            }
        }

        base64_result
    }
}

/// 获取特殊应用目录检测状态（动态路径）
#[tauri::command]
fn get_special_folders_status() -> Result<Vec<app_manager::detector::SpecialFolder>, String> {
    app_manager::detector::get_special_folders_status()
}

/// 迁移特殊应用目录（含进程预检）
#[tauri::command]
fn migrate_special_folder(app_name: String, source_path: String, target_dir: String) -> Result<MigrationResult, String> {
    app_manager::detector::migrate_special_folder(app_name, source_path, target_dir)
}

/// 解析图标路径，分离文件路径和图标索引
/// 
/// # 示例
/// - "C:\app.exe" -> ("C:\app.exe", 0)
/// - "C:\app.exe,0" -> ("C:\app.exe", 0)
/// - "C:\app.exe,-101" -> ("C:\app.exe", -101)
/// - "\"C:\Program Files\app.exe\",0" -> ("C:\Program Files\app.exe", 0)
#[cfg(windows)]
fn parse_icon_path(icon_path: &str) -> (String, i32) {
    // 去除首尾空格和引号
    let path = icon_path.trim().trim_matches('"');
    
    // 查找最后一个逗号（图标索引分隔符）
    if let Some(comma_pos) = path.rfind(',') {
        let file_part = &path[..comma_pos];
        let index_part = &path[comma_pos + 1..];
        
        // 尝试解析索引
        if let Ok(index) = index_part.trim().parse::<i32>() {
            return (file_part.trim().trim_matches('"').to_string(), index);
        }
    }
    
    // 没有索引，默认使用 0
    (path.trim_matches('"').to_string(), 0)
}

/// 将 HICON 图标句柄转换为 Base64 编码的 PNG 数据
/// 
/// # 技术实现
/// 1. 使用 GetIconInfo 获取图标的颜色位图和掩码位图
/// 2. 使用 GetDIBits 将位图转换为 BGRA 像素数据
/// 3. 将 BGRA 转换为 RGBA 格式
/// 4. 使用 image crate 创建 PNG 图像
/// 5. 使用 base64 编码
#[cfg(windows)]
fn icon_to_base64(icon: windows::Win32::UI::WindowsAndMessaging::HICON) -> String {
    unsafe {
        // 获取图标信息
        let mut icon_info = ICONINFO::default();
        if GetIconInfo(icon, &mut icon_info).is_err() {
            return String::new();
        }

        // 获取颜色位图信息
        let hbm_color = icon_info.hbmColor;
        if hbm_color.is_invalid() {
            // 清理资源
            if !icon_info.hbmMask.is_invalid() {
                let _ = DeleteObject(icon_info.hbmMask);
            }
            return String::new();
        }

        // 获取位图尺寸
        let mut bitmap = BITMAP::default();
        let bitmap_size = std::mem::size_of::<BITMAP>() as i32;
        if GetObjectW(hbm_color, bitmap_size, Some(&mut bitmap as *mut _ as *mut _)) == 0 {
            let _ = DeleteObject(hbm_color);
            if !icon_info.hbmMask.is_invalid() {
                let _ = DeleteObject(icon_info.hbmMask);
            }
            return String::new();
        }

        let width = bitmap.bmWidth as u32;
        let height = bitmap.bmHeight as u32;
        
        // 限制图标大小，避免处理过大的图标
        if width == 0 || height == 0 || width > 256 || height > 256 {
            let _ = DeleteObject(hbm_color);
            if !icon_info.hbmMask.is_invalid() {
                let _ = DeleteObject(icon_info.hbmMask);
            }
            return String::new();
        }

        // 创建设备上下文
        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            let _ = DeleteObject(hbm_color);
            if !icon_info.hbmMask.is_invalid() {
                let _ = DeleteObject(icon_info.hbmMask);
            }
            return String::new();
        }

        // 选择位图到设备上下文
        let old_bitmap = SelectObject(hdc, hbm_color);

        // 准备 BITMAPINFO 结构
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // 负值表示自上而下的位图
                biPlanes: 1,
                biBitCount: 32, // 32 位 BGRA
                biCompression: 0, // BI_RGB
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [windows::Win32::Graphics::Gdi::RGBQUAD::default(); 1],
        };

        // 分配像素缓冲区
        let pixel_count = (width * height) as usize;
        let mut pixels: Vec<u8> = vec![0; pixel_count * 4];

        // 获取位图像素数据
        let result = GetDIBits(
            hdc,
            hbm_color,
            0,
            height,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // 清理资源
        SelectObject(hdc, old_bitmap);
        let _ = DeleteDC(hdc);
        let _ = DeleteObject(hbm_color);
        if !icon_info.hbmMask.is_invalid() {
            let _ = DeleteObject(icon_info.hbmMask);
        }

        if result == 0 {
            return String::new();
        }

        // 将 BGRA 转换为 RGBA
        for i in 0..pixel_count {
            let offset = i * 4;
            pixels.swap(offset, offset + 2); // 交换 B 和 R
        }

        // 使用 image crate 创建 PNG
        match image::RgbaImage::from_raw(width, height, pixels) {
            Some(img) => {
                let mut png_data = Cursor::new(Vec::new());
                if img.write_to(&mut png_data, image::ImageFormat::Png).is_ok() {
                    // 编码为 Base64
                    let base64_str = BASE64_STANDARD.encode(png_data.into_inner());
                    format!("data:image/png;base64,{}", base64_str)
                } else {
                    String::new()
                }
            }
            None => String::new(),
        }
    }
}

/// 非 Windows 平台的图标提取占位函数
#[cfg(not(windows))]
fn extract_icon_to_base64(_icon_path: &str) -> String {
    String::new()
}

/// 磁盘使用信息结构体
/// 包含磁盘的总容量和可用空间
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiskUsage {
    /// 磁盘盘符（如 "C:", "D:"）
    pub mount_point: String,
    /// 磁盘名称（如 "系统", "数据"）
    pub name: String,
    /// 总容量（字节）
    pub total_space: u64,
    /// 可用空间（字节）
    pub free_space: u64,
    /// 已使用空间（字节）
    pub used_space: u64,
    /// 使用百分比
    pub usage_percent: f64,
    /// 是否为系统盘
    pub is_system: bool,
}

// ============================================================================
// 大文件夹发现与管理
// ============================================================================

/// 大文件夹类型枚举
/// 区分系统文件夹和应用数据文件夹，用于前端显示不同的风险提示
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum LargeFolderType {
    /// 系统文件夹（桌面、文档、下载等）- 迁移风险较高
    System,
    /// 应用数据文件夹（微信、钉钉等）- 迁移风险较低
    AppData,
}

/// 大文件夹信息结构体
/// 用于展示可迁移的大文件夹信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LargeFolder {
    /// 文件夹唯一标识（如 "desktop", "wechat"）
    pub id: String,
    /// 显示名称（如 "桌面", "微信"）
    pub display_name: String,
    /// 文件夹完整路径
    pub path: String,
    /// 文件夹大小（字节）
    pub size: u64,
    /// 文件夹类型
    pub folder_type: LargeFolderType,
    /// 是否已经是 Junction（已迁移）
    pub is_junction: bool,
    /// Junction 目标路径（如果已迁移）
    pub junction_target: Option<String>,
    /// 关联的应用名称（用于进程检测）
    pub app_process_names: Vec<String>,
    /// 图标标识（用于前端显示）
    pub icon_id: String,
    /// 是否存在
    pub exists: bool,
}

/// 检测路径是否为 Junction（目录联接）
/// 
/// # 技术说明
/// Windows Junction 是一种特殊的重解析点（Reparse Point）
/// 通过检查文件属性中的 FILE_ATTRIBUTE_REPARSE_POINT 标志来判断
#[cfg(windows)]
fn is_junction(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    
    if let Ok(metadata) = fs::symlink_metadata(path) {
        // FILE_ATTRIBUTE_REPARSE_POINT = 0x400
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return (metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
    }
    false
}

#[cfg(not(windows))]
fn is_junction(_path: &Path) -> bool {
    false
}

/// 获取 Junction 的目标路径
/// 
/// # 技术说明
/// 使用 fs::read_link 读取符号链接/Junction 的目标路径
#[cfg(windows)]
fn get_junction_target(path: &Path) -> Option<String> {
    if is_junction(path) {
        if let Ok(target) = fs::read_link(path) {
            // Junction 目标路径可能带有 \\?\ 前缀，需要去除
            let target_str = target.to_string_lossy().to_string();
            return Some(target_str.trim_start_matches("\\\\?\\").to_string());
        }
    }
    None
}

#[cfg(not(windows))]
fn get_junction_target(_path: &Path) -> Option<String> {
    None
}

/// 获取文件夹大小（递归计算）
/// 使用 fs_extra 的 get_size 函数，性能较好
fn get_folder_size(path: &Path) -> u64 {
    if path.exists() && path.is_dir() {
        get_size(path).unwrap_or(0)
    } else {
        0
    }
}

/// 获取大文件夹列表
/// 
/// # 路径定位说明（中文）
/// 
/// ## 系统文件夹定位
/// 使用 `dirs` crate 获取 Windows 已知文件夹路径，该库内部调用 Windows Shell API：
/// - 桌面 (Desktop): `dirs::desktop_dir()` → 通常为 `C:\Users\用户名\Desktop`
/// - 文档 (Documents): `dirs::document_dir()` → 通常为 `C:\Users\用户名\Documents`
/// - 下载 (Downloads): `dirs::download_dir()` → 通常为 `C:\Users\用户名\Downloads`
/// - 图片 (Pictures): `dirs::picture_dir()` → 通常为 `C:\Users\用户名\Pictures`
/// - 视频 (Videos): `dirs::video_dir()` → 通常为 `C:\Users\用户名\Videos`
/// 
/// ## 办公软件数据路径定位
/// 这些路径是各软件的默认数据存储位置，通过环境变量拼接：
/// 
/// ### 微信 (WeChat)
/// 路径: `%USERPROFILE%\Documents\WeChat Files`
/// 说明: 微信默认将聊天记录、图片、文件等存储在此目录
/// 进程名: WeChat.exe
/// 
/// ### 企业微信 (WXWork)
/// 路径: `%USERPROFILE%\Documents\WXWork`
/// 说明: 企业微信的数据目录，结构与微信类似
/// 进程名: WXWork.exe
/// 
/// ### QQ
/// 路径: `%USERPROFILE%\Documents\Tencent Files`
/// 说明: QQ 的聊天记录和文件存储目录
/// 进程名: QQ.exe
/// 
/// ### 钉钉 (DingTalk)
/// 路径: `%APPDATA%\DingTalk`
/// 说明: 钉钉的应用数据目录，包含缓存和配置
/// 进程名: DingTalk.exe
/// 
/// ### 飞书 (Feishu/Lark)
/// 路径1: `%APPDATA%\LarkShell` (旧版/部分版本)
/// 路径2: `%LOCALAPPDATA%\LarkShell` (新版)
/// 说明: 飞书在不同版本可能使用不同路径
/// 进程名: Lark.exe, Feishu.exe
#[tauri::command]
fn get_large_folders() -> Result<Vec<LargeFolder>, String> {
    let mut folders: Vec<LargeFolder> = Vec::new();
    
    // ========== 系统文件夹 ==========
    // 使用 dirs crate 获取系统已知文件夹路径
    
    // 桌面
    if let Some(desktop) = dirs::desktop_dir() {
        let path_str = desktop.to_string_lossy().to_string();
        let is_junc = is_junction(&desktop);
        folders.push(LargeFolder {
            id: "desktop".to_string(),
            display_name: "桌面".to_string(),
            path: path_str.clone(),
            size: if is_junc { 0 } else { get_folder_size(&desktop) },
            folder_type: LargeFolderType::System,
            is_junction: is_junc,
            junction_target: get_junction_target(&desktop),
            app_process_names: vec!["explorer.exe".to_string()],
            icon_id: "desktop".to_string(),
            exists: desktop.exists(),
        });
    }
    
    // 文档
    if let Some(documents) = dirs::document_dir() {
        let path_str = documents.to_string_lossy().to_string();
        let is_junc = is_junction(&documents);
        folders.push(LargeFolder {
            id: "documents".to_string(),
            display_name: "文档".to_string(),
            path: path_str.clone(),
            size: if is_junc { 0 } else { get_folder_size(&documents) },
            folder_type: LargeFolderType::System,
            is_junction: is_junc,
            junction_target: get_junction_target(&documents),
            app_process_names: vec![],
            icon_id: "documents".to_string(),
            exists: documents.exists(),
        });
    }
    
    // 下载
    if let Some(downloads) = dirs::download_dir() {
        let path_str = downloads.to_string_lossy().to_string();
        let is_junc = is_junction(&downloads);
        folders.push(LargeFolder {
            id: "downloads".to_string(),
            display_name: "下载".to_string(),
            path: path_str.clone(),
            size: if is_junc { 0 } else { get_folder_size(&downloads) },
            folder_type: LargeFolderType::System,
            is_junction: is_junc,
            junction_target: get_junction_target(&downloads),
            app_process_names: vec![],
            icon_id: "downloads".to_string(),
            exists: downloads.exists(),
        });
    }
    
    // 图片
    if let Some(pictures) = dirs::picture_dir() {
        let path_str = pictures.to_string_lossy().to_string();
        let is_junc = is_junction(&pictures);
        folders.push(LargeFolder {
            id: "pictures".to_string(),
            display_name: "图片".to_string(),
            path: path_str.clone(),
            size: if is_junc { 0 } else { get_folder_size(&pictures) },
            folder_type: LargeFolderType::System,
            is_junction: is_junc,
            junction_target: get_junction_target(&pictures),
            app_process_names: vec![],
            icon_id: "pictures".to_string(),
            exists: pictures.exists(),
        });
    }
    
    // 视频
    if let Some(videos) = dirs::video_dir() {
        let path_str = videos.to_string_lossy().to_string();
        let is_junc = is_junction(&videos);
        folders.push(LargeFolder {
            id: "videos".to_string(),
            display_name: "视频".to_string(),
            path: path_str.clone(),
            size: if is_junc { 0 } else { get_folder_size(&videos) },
            folder_type: LargeFolderType::System,
            is_junction: is_junc,
            junction_target: get_junction_target(&videos),
            app_process_names: vec![],
            icon_id: "videos".to_string(),
            exists: videos.exists(),
        });
    }
    
    // ========== 办公软件数据文件夹 ==========
    // 通过环境变量获取用户目录路径
    // 
    // 注意：这些路径是各软件的默认数据存储位置
    // 如果用户在软件设置中更改了存储位置，则需要手动添加
    
    // 获取用户目录 (%USERPROFILE%)
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    // 获取 AppData\Roaming (%APPDATA%)
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    // 获取 AppData\Local (%LOCALAPPDATA%)
    let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
    
    // 辅助函数：添加应用数据文件夹
    // 无论目录是否存在都添加，便于用户了解支持的应用
    fn add_app_folder(
        folders: &mut Vec<LargeFolder>,
        id: &str,
        display_name: &str,
        path: PathBuf,
        process_names: Vec<String>,
        icon_id: &str,
    ) {
        let exists = path.exists();
        let path_str = path.to_string_lossy().to_string();
        let is_junc = if exists { is_junction(&path) } else { false };
        
        folders.push(LargeFolder {
            id: id.to_string(),
            display_name: display_name.to_string(),
            path: path_str,
            size: if exists && !is_junc { get_folder_size(&path) } else { 0 },
            folder_type: LargeFolderType::AppData,
            is_junction: is_junc,
            junction_target: if is_junc { get_junction_target(&path) } else { None },
            app_process_names: process_names,
            icon_id: icon_id.to_string(),
            exists,
        });
    }
    
    // 微信 - %USERPROFILE%\Documents\WeChat Files
    // 微信默认将聊天记录、图片、文件等存储在此目录
    // 用户可以在微信设置中更改此路径
    add_app_folder(
        &mut folders,
        "wechat",
        "微信",
        PathBuf::from(&user_profile).join("Documents").join("WeChat Files"),
        vec!["WeChat.exe".to_string()],
        "wechat",
    );
    
    // 企业微信 - %USERPROFILE%\Documents\WXWork
    add_app_folder(
        &mut folders,
        "wxwork",
        "企业微信",
        PathBuf::from(&user_profile).join("Documents").join("WXWork"),
        vec!["WXWork.exe".to_string()],
        "wxwork",
    );
    
    // QQ - %USERPROFILE%\Documents\Tencent Files
    add_app_folder(
        &mut folders,
        "qq",
        "QQ",
        PathBuf::from(&user_profile).join("Documents").join("Tencent Files"),
        vec!["QQ.exe".to_string()],
        "qq",
    );
    
    // 钉钉 - %APPDATA%\DingTalk
    add_app_folder(
        &mut folders,
        "dingtalk",
        "钉钉",
        PathBuf::from(&appdata).join("DingTalk"),
        vec!["DingTalk.exe".to_string()],
        "dingtalk",
    );
    
    // 飞书 - 检查多个可能的路径
    // 飞书在不同版本可能使用不同路径
    let feishu_appdata = PathBuf::from(&appdata).join("LarkShell");
    let feishu_localappdata = PathBuf::from(&localappdata).join("LarkShell");
    let feishu_path = if feishu_appdata.exists() {
        feishu_appdata
    } else {
        feishu_localappdata
    };
    
    add_app_folder(
        &mut folders,
        "feishu",
        "飞书",
        feishu_path,
        vec!["Lark.exe".to_string(), "Feishu.exe".to_string()],
        "feishu",
    );
    
    // 按大小降序排序（已迁移的排在后面）
    folders.sort_by(|a, b| {
        // 已迁移的排在后面
        if a.is_junction && !b.is_junction {
            return std::cmp::Ordering::Greater;
        }
        if !a.is_junction && b.is_junction {
            return std::cmp::Ordering::Less;
        }
        // 按大小降序
        b.size.cmp(&a.size)
    });
    
    Ok(folders)
}

/// 迁移大文件夹
/// 复用现有的迁移逻辑，但增加了对系统文件夹的特殊处理
#[tauri::command]
fn migrate_large_folder(source_path: String, target_dir: String) -> Result<MigrationResult, String> {
    // 复用现有的 migrate_app 逻辑
    // source_path 是要迁移的文件夹路径
    // target_dir 是目标目录（文件夹会被移动到这个目录下）
    
    #[cfg(windows)]
    {
        let source = Path::new(&source_path);
        
        // 检查源路径是否存在
        if !source.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("源路径不存在: {}", source_path),
                new_path: None,
            });
        }
        
        // 检查是否已经是 Junction
        if is_junction(source) {
            return Ok(MigrationResult {
                success: false,
                message: "该文件夹已经被迁移过了".to_string(),
                new_path: None,
            });
        }
        
        // 获取文件夹名称
        let folder_name = source.file_name()
            .ok_or("无法获取文件夹名称")?
            .to_string_lossy()
            .to_string();
        
        // 构建目标路径
        let target_path = Path::new(&target_dir).join(&folder_name);
        let target_path_str = target_path.to_string_lossy().to_string();
        
        // 检查目标路径是否已存在
        if target_path.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("目标路径已存在: {}", target_path_str),
                new_path: None,
            });
        }
        
        // ========== 步骤 1: 复制文件夹 ==========
        let mut options = CopyOptions::new();
        options.overwrite = false;
        options.copy_inside = true;
        
        // 复制文件夹到目标位置
        copy(&source_path, &target_dir, &options).map_err(|e| {
            format!("复制文件夹失败: {}", e)
        })?;
        
        // ========== 步骤 2: 验证复制完整性 ==========
        let source_size = get_size(&source_path).unwrap_or(0);
        let target_size = get_size(&target_path).unwrap_or(0);
        
        // 允许 1% 的误差（某些系统文件可能无法复制）
        if target_size < source_size * 99 / 100 {
            // 复制不完整，清理目标文件夹
            let _ = fs::remove_dir_all(&target_path);
            return Ok(MigrationResult {
                success: false,
                message: format!(
                    "文件复制不完整。源大小: {} 字节，目标大小: {} 字节",
                    source_size, target_size
                ),
                new_path: None,
            });
        }
        
        // ========== 步骤 3: 备份并删除原文件夹 ==========
        let backup_path = source.with_file_name(format!("{}_orbitfile_backup", folder_name));
        
        // 重命名原文件夹为备份
        fs::rename(&source, &backup_path).map_err(|e| {
            // 重命名失败，清理目标文件夹
            let _ = fs::remove_dir_all(&target_path);
            format!("无法备份原文件夹: {}。请确保没有程序正在使用该文件夹。", e)
        })?;
        
        // ========== 步骤 4: 创建 Junction ==========
        match symlink_dir(&target_path, &source) {
            Ok(_) => {
                // Junction 创建成功，删除备份
                if let Err(e) = fs::remove_dir_all(&backup_path) {
                    eprintln!("警告: 无法删除备份文件夹: {}", e);
                }
                
                // ========== 步骤 5: 保存迁移记录 ==========
                if let Err(e) = add_migration_record(
                    &folder_name,
                    &source_path,
                    &target_path_str,
                    source_size,
                    MigrationRecordType::LargeFolder,
                ) {
                    eprintln!("警告: 保存迁移记录失败: {}", e);
                }
                
                Ok(MigrationResult {
                    success: true,
                    message: format!("迁移成功！文件夹已从 {} 迁移到 {}", source_path, target_path_str),
                    new_path: Some(target_path_str),
                })
            }
            Err(e) => {
                // Junction 创建失败，尝试恢复
                if let Err(restore_err) = fs::rename(&backup_path, &source) {
                    return Ok(MigrationResult {
                        success: false,
                        message: format!(
                            "严重错误: 创建链接失败 ({})，且无法恢复原文件夹 ({})。\n备份位置: {}",
                            e, restore_err, backup_path.to_string_lossy()
                        ),
                        new_path: None,
                    });
                }
                
                // 清理目标文件夹
                let _ = fs::remove_dir_all(&target_path);
                
                Ok(MigrationResult {
                    success: false,
                    message: format!("创建符号链接失败: {}。原文件夹已恢复。", e),
                    new_path: None,
                })
            }
        }
    }
    
    #[cfg(not(windows))]
    {
        Ok(MigrationResult {
            success: false,
            message: "此功能仅支持 Windows 系统".to_string(),
            new_path: None,
        })
    }
}

/// 恢复大文件夹（从 Junction 恢复到原位置）
#[tauri::command]
fn restore_large_folder(junction_path: String) -> Result<MigrationResult, String> {
    #[cfg(windows)]
    {
        let junction = Path::new(&junction_path);
        
        // 检查是否为 Junction
        if !is_junction(junction) {
            return Ok(MigrationResult {
                success: false,
                message: "该路径不是一个符号链接，无法恢复".to_string(),
                new_path: None,
            });
        }
        
        // 获取 Junction 目标路径
        let target_path = match get_junction_target(junction) {
            Some(target) => PathBuf::from(target),
            None => {
                return Ok(MigrationResult {
                    success: false,
                    message: "无法读取符号链接的目标路径".to_string(),
                    new_path: None,
                });
            }
        };
        
        // 检查目标路径是否存在
        if !target_path.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("目标路径不存在: {}", target_path.to_string_lossy()),
                new_path: None,
            });
        }
        
        // ========== 步骤 1: 删除 Junction ==========
        fs::remove_dir(&junction_path).map_err(|e| {
            format!("无法删除符号链接: {}", e)
        })?;
        
        // ========== 步骤 2: 移动文件夹回原位置 ==========
        let mut options = CopyOptions::new();
        options.overwrite = false;
        options.copy_inside = false;
        
        // 获取原路径的父目录
        let original_parent = junction.parent()
            .ok_or("无法获取原路径的父目录")?;
        
        move_dir(&target_path, original_parent, &options).map_err(|e| {
            // 移动失败，尝试恢复 Junction
            let _ = symlink_dir(&target_path, junction);
            format!("移动文件夹失败: {}。已恢复符号链接。", e)
        })?;
        
        // ========== 步骤 3: 更新迁移记录状态 ==========
        if let Err(e) = update_migration_record_status(&junction_path, "restored") {
            eprintln!("警告: 更新迁移记录状态失败: {}", e);
        }
        
        Ok(MigrationResult {
            success: true,
            message: format!("恢复成功！文件夹已恢复到 {}", junction_path),
            new_path: Some(junction_path.clone()),
        })
    }
    
    #[cfg(not(windows))]
    {
        Ok(MigrationResult {
            success: false,
            message: "此功能仅支持 Windows 系统".to_string(),
            new_path: None,
        })
    }
}

/// 获取已安装应用列表
/// 扫描 Windows 注册表中的 Uninstall 键，提取应用信息
#[tauri::command]
fn get_installed_apps() -> Result<Vec<InstalledApp>, String> {
    app_manager::scanner::get_installed_apps()
}

/// 获取所有磁盘使用情况
/// 使用 sysinfo 库读取系统所有磁盘信息
#[tauri::command]
fn get_disk_usage() -> Result<Vec<DiskUsage>, String> {
    // 创建磁盘信息实例
    let disks = Disks::new_with_refreshed_list();
    let mut result: Vec<DiskUsage> = Vec::new();
    
    // 遍历所有磁盘
    for disk in disks.list() {
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        let total_space = disk.total_space();
        
        // 跳过容量为 0 的磁盘（如虚拟磁盘）
        if total_space == 0 {
            continue;
        }
        
        let free_space = disk.available_space();
        let used_space = total_space.saturating_sub(free_space);
        let usage_percent = if total_space > 0 {
            (used_space as f64 / total_space as f64) * 100.0
        } else {
            0.0
        };
        
        // 获取磁盘名称
        let disk_name = disk.name().to_string_lossy().to_string();
        let name = if disk_name.is_empty() {
            // 如果没有名称，使用默认名称
            if mount_point.starts_with("C:") {
                "系统".to_string()
            } else {
                "本地磁盘".to_string()
            }
        } else {
            disk_name
        };
        
        // 判断是否为系统盘
        let is_system = mount_point.starts_with("C:") || mount_point == "/";
        
        result.push(DiskUsage {
            mount_point,
            name,
            total_space,
            free_space,
            used_space,
            usage_percent,
            is_system,
        });
    }
    
    // 按盘符排序，系统盘优先
    result.sort_by(|a, b| {
        if a.is_system && !b.is_system {
            std::cmp::Ordering::Less
        } else if !a.is_system && b.is_system {
            std::cmp::Ordering::Greater
        } else {
            a.mount_point.cmp(&b.mount_point)
        }
    });
    
    if result.is_empty() {
        Err("无法获取磁盘信息".to_string())
    } else {
        Ok(result)
    }
}

// ============================================================================
// Phase 2: 核心迁移引擎
// ============================================================================

/// 迁移结果结构体
/// 用于向前端返回迁移操作的详细结果
#[derive(Debug, Serialize, Deserialize)]
pub struct MigrationResult {
    /// 是否成功
    pub success: bool,
    /// 结果消息
    pub message: String,
    /// 新的安装路径（成功时返回）
    pub new_path: Option<String>,
}

/// 进程锁检测结果
/// 返回占用源路径文件的进程列表
#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessLockResult {
    /// 是否有进程占用
    pub is_locked: bool,
    /// 占用进程名称列表
    pub processes: Vec<String>,
}

/// 检测指定路径是否被进程占用
/// 使用 sysinfo 扫描所有进程，检查其打开的文件是否在源路径下
/// 
/// # 参数
/// - `source_path`: 要检测的源文件夹路径
/// 
/// # 返回
/// - `ProcessLockResult`: 包含是否被锁定及占用进程列表
#[tauri::command]
fn check_process_locks(source_path: String) -> Result<ProcessLockResult, String> {
    app_manager::scanner::check_process_locks(source_path)
}

/// 将应用从源路径迁移到目标路径，并创建 Windows 目录联接（Junction）
/// 
/// # 迁移流程详解
/// 
/// 1. **空间检查**: 计算源文件夹大小，确认目标磁盘有足够空间
/// 2. **创建临时目录**: 在目标路径下创建临时文件夹存放复制的文件
/// 3. **递归复制**: 使用 fs_extra 将所有文件从源路径复制到目标
/// 4. **完整性校验**: 比较源和目标文件夹的总大小是否一致
/// 5. **备份原目录**: 将原始源目录重命名为 xxx_backup
/// 6. **创建 Junction**: 在原路径创建指向新位置的目录联接
///    - Junction 是 Windows 特有的目录链接，对应用程序透明
///    - 应用仍然认为文件在原位置，但实际存储在新磁盘
/// 7. **清理备份**: 迁移成功后删除备份目录
/// 8. **回滚机制**: 任何步骤失败都会尝试恢复原状态
/// 
/// # 参数
/// - `app_name`: 应用名称（用于记录历史）
/// - `source`: 源路径（应用原安装位置）
/// - `target_parent`: 目标父目录（用户选择的目标文件夹）
/// 
/// # 返回
/// - `MigrationResult`: 迁移结果，包含成功状态和新路径
#[tauri::command]
fn migrate_app(app_name: String, source: String, target_parent: String) -> Result<MigrationResult, String> {
    app_manager::migration::migrate_app(app_name, source, target_parent)
}

/// 启动应用卸载流程
/// 支持按 app_id 或 registry_path 触发卸载
#[tauri::command]
async fn uninstall_application(input: app_manager::uninstaller::UninstallInput) -> Result<app_manager::uninstaller::UninstallResult, String> {
    app_manager::uninstaller::uninstall_application(input).await
}

/// 独立扫描应用残留
#[tauri::command]
fn scan_app_residue(
    app_name: String,
    publisher: Option<String>,
    install_location: Option<String>,
) -> Result<Vec<app_manager::uninstaller::LeftoverItem>, String> {
    app_manager::uninstaller::scan_app_residue(app_name, publisher, install_location)
}

/// 清理用户确认的残留路径/注册表项
#[tauri::command]
fn execute_cleanup(
    items: Vec<String>,
    app_name: Option<String>,
    publisher: Option<String>,
) -> Result<app_manager::uninstaller::CleanupResult, String> {
    app_manager::uninstaller::execute_cleanup(items, app_name, publisher)
}

// ============================================================================
// Phase 3: 持久化存储 - 迁移历史记录
// ============================================================================
// 
// 持久化方案说明：
// 使用 JSON 文件存储迁移历史记录，存放在用户的 AppData 目录下
// 路径：%APPDATA%/orbit-file/migration_history.json
// 
// 选择 JSON 而非 SQLite 的原因：
// 1. 轻量级：无需额外依赖，减少包体积
// 2. 可读性：用户可直接查看/编辑历史记录
// 3. 简单可靠：迁移历史是低频写入场景，JSON 完全够用
// ============================================================================

/// 迁移记录类型枚举
/// 区分应用迁移和文件夹迁移
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum MigrationRecordType {
    /// 应用迁移
    App,
    /// 大文件夹迁移（系统文件夹或应用数据）
    LargeFolder,
}

/// 迁移历史记录结构体
/// 记录每次迁移的详细信息，用于历史查看和恢复操作
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MigrationRecord {
    /// 唯一标识符（使用时间戳生成）
    pub id: String,
    /// 应用/文件夹名称
    pub app_name: String,
    /// 原始路径（迁移前的位置，现在是 Junction 链接）
    pub original_path: String,
    /// 目标路径（迁移后的实际存储位置）
    pub target_path: String,
    /// 迁移大小（字节）
    pub size: u64,
    /// 迁移时间（Unix 时间戳，毫秒）
    pub migrated_at: u64,
    /// 状态：active（已迁移）、restored（已恢复）
    pub status: String,
    /// 记录类型：App（应用）或 LargeFolder（大文件夹）
    /// 使用 Option 保持向后兼容，旧记录默认为 App
    #[serde(default = "default_record_type")]
    pub record_type: MigrationRecordType,
}

/// 默认记录类型（用于反序列化旧数据）
fn default_record_type() -> MigrationRecordType {
    MigrationRecordType::App
}

/// 历史记录存储结构
/// 包含版本号和记录列表，便于后续升级数据格式
#[derive(Debug, Serialize, Deserialize)]
struct HistoryStorage {
    /// 数据格式版本
    version: u32,
    /// 迁移记录列表
    records: Vec<MigrationRecord>,
}

/// 获取历史记录文件路径
/// 返回 %APPDATA%/orbit-file/migration_history.json
fn get_history_file_path() -> PathBuf {
    // 获取 AppData 目录
    let app_data = std::env::var("APPDATA")
        .unwrap_or_else(|_| ".".to_string());
    
    let dir = PathBuf::from(app_data).join("orbit-file");
    
    // 确保目录存在
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    
    dir.join("migration_history.json")
}

/// 读取历史记录
/// 从 JSON 文件加载所有迁移记录
fn load_history() -> HistoryStorage {
    let path = get_history_file_path();
    
    if !path.exists() {
        // 文件不存在，返回空记录
        return HistoryStorage {
            version: 1,
            records: Vec::new(),
        };
    }
    
    // 读取文件内容
    let mut file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return HistoryStorage { version: 1, records: Vec::new() },
    };
    
    let mut contents = String::new();
    if file.read_to_string(&mut contents).is_err() {
        return HistoryStorage { version: 1, records: Vec::new() };
    }
    
    // 解析 JSON
    serde_json::from_str(&contents).unwrap_or(HistoryStorage {
        version: 1,
        records: Vec::new(),
    })
}

/// 保存历史记录
/// 将记录列表写入 JSON 文件
///
/// 采用原子写入策略：先写入临时文件，再重命名覆盖目标文件
/// 这样即使写入过程中断电/崩溃，也不会损坏原有数据
fn save_history(storage: &HistoryStorage) -> Result<(), String> {
    let path = get_history_file_path();
    let temp_path = path.with_extension("json.tmp");
    let backup_path = path.with_extension("json.bak");
    
    // 序列化为格式化的 JSON（便于人工查看）
    let json = serde_json::to_string_pretty(storage)
        .map_err(|e| format!("序列化历史记录失败: {}", e))?;
    
    // 1. 写入临时文件
    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("创建临时文件失败: {}", e))?;
    
    file.write_all(json.as_bytes())
        .map_err(|e| format!("写入临时文件失败: {}", e))?;
    
    // 确保数据刷盘
    file.sync_all()
        .map_err(|e| format!("同步临时文件失败: {}", e))?;
    
    // 2. 备份旧文件（如果存在）
    if path.exists() {
        let _ = fs::copy(&path, &backup_path); // 备份失败不阻塞主流程
    }
    
    // 3. 原子重命名：临时文件 -> 目标文件
    fs::rename(&temp_path, &path)
        .map_err(|e| format!("重命名历史文件失败: {}", e))?;
    
    Ok(())
}

/// 添加迁移记录
/// 在迁移成功后调用，记录迁移信息
/// record_type: 记录类型，App 或 LargeFolder
pub(crate) fn add_migration_record(
    app_name: &str,
    original_path: &str,
    target_path: &str,
    size: u64,
    record_type: MigrationRecordType,
) -> Result<String, String> {
    let mut storage = load_history();
    
    // 生成唯一 ID（使用当前时间戳）
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    
    let id = format!("mig_{}", timestamp);
    
    let record = MigrationRecord {
        id: id.clone(),
        app_name: app_name.to_string(),
        original_path: original_path.to_string(),
        target_path: target_path.to_string(),
        size,
        migrated_at: timestamp,
        status: "active".to_string(),
        record_type,
    };
    
    storage.records.push(record);
    save_history(&storage)?;
    
    Ok(id)
}

/// 更新迁移记录状态
/// 根据原始路径查找记录并更新状态
fn update_migration_record_status(original_path: &str, new_status: &str) -> Result<(), String> {
    let mut storage = load_history();
    
    // 查找匹配的记录并更新状态
    let mut found = false;
    for record in storage.records.iter_mut() {
        if record.original_path == original_path && record.status == "active" {
            record.status = new_status.to_string();
            found = true;
            break;
        }
    }
    
    if !found {
        return Err(format!("未找到路径 {} 的迁移记录", original_path));
    }
    
    save_history(&storage)?;
    Ok(())
}

/// 获取迁移历史记录
/// 返回所有迁移记录，供前端展示
#[tauri::command]
fn get_migration_history() -> Result<Vec<MigrationRecord>, String> {
    let storage = load_history();
    // 只返回状态为 active 的记录（已恢复的不显示）
    let active_records: Vec<MigrationRecord> = storage.records
        .into_iter()
        .filter(|r| r.status == "active")
        .collect();
    Ok(active_records)
}

/// 获取所有已迁移应用的原始路径列表
/// 用于前端判断应用是否已迁移
#[tauri::command]
fn get_migrated_paths() -> Result<Vec<String>, String> {
    let storage = load_history();
    let paths: Vec<String> = storage.records
        .iter()
        .filter(|r| r.status == "active")
        .map(|r| r.original_path.clone())
        .collect();
    Ok(paths)
}

/// 链接健康状态检查结果
#[derive(Debug, Serialize, Deserialize)]
pub struct LinkStatusResult {
    /// 链接是否健康（原路径是 Junction 且目标路径存在）
    pub healthy: bool,
    /// 目标路径是否存在
    pub target_exists: bool,
    /// 原路径是否是 Junction
    pub is_junction: bool,
    /// 错误信息（如果有）
    pub error: Option<String>,
}

/// 检查迁移记录的链接健康状态
/// 
/// 检查逻辑：
/// 1. 根据记录 ID 查找迁移记录
/// 2. 检查原路径是否仍然是 Junction
/// 3. 检查目标路径是否存在（例如：移动硬盘是否已连接）
/// 
/// 这个检查是轻量级的，不会阻塞 UI
#[tauri::command]
fn check_link_status(record_id: String) -> Result<LinkStatusResult, String> {
    let storage = load_history();
    
    // 查找记录
    let record = storage.records
        .iter()
        .find(|r| r.id == record_id && r.status == "active");
    
    let record = match record {
        Some(r) => r,
        None => return Ok(LinkStatusResult {
            healthy: false,
            target_exists: false,
            is_junction: false,
            error: Some("未找到该迁移记录".to_string()),
        }),
    };
    
    let original_path = Path::new(&record.original_path);
    let target_path = Path::new(&record.target_path);
    
    // 检查原路径是否是 Junction
    let is_junc = is_junction(original_path);
    
    // 检查目标路径是否存在
    let target_exists = target_path.exists();
    
    // 健康状态：原路径是 Junction 且目标路径存在
    let healthy = is_junc && target_exists;
    
    Ok(LinkStatusResult {
        healthy,
        target_exists,
        is_junction: is_junc,
        error: None,
    })
}

/// 清理无效的迁移记录（幽灵链接清理器）
/// 
/// 清理逻辑：
/// 1. 扫描所有活跃的迁移记录
/// 2. 检查每条记录的目标路径是否存在
/// 3. 如果目标路径不存在（幽灵链接）：
///    - 删除原路径的 Junction（如果存在）
///    - 将记录状态标记为 "ghost_cleaned"
/// 4. 返回清理的记录数量
#[tauri::command]
fn clean_ghost_links() -> Result<CleanupResult, String> {
    let mut storage = load_history();
    let mut cleaned_count = 0;
    let mut cleaned_size: u64 = 0;
    let mut errors: Vec<String> = Vec::new();
    
    // 遍历所有活跃记录
    for record in storage.records.iter_mut() {
        if record.status != "active" {
            continue;
        }
        
        let original_path = Path::new(&record.original_path);
        let target_path = Path::new(&record.target_path);
        
        // 检查目标路径是否存在
        if !target_path.exists() {
            // 目标路径不存在，这是一个幽灵链接
            
            // 尝试删除原路径的 Junction
            if original_path.exists() && is_junction(original_path) {
                if let Err(e) = fs::remove_dir(original_path) {
                    errors.push(format!("无法删除 Junction {}: {}", record.original_path, e));
                    continue;
                }
            }
            
            // 更新记录状态
            record.status = "ghost_cleaned".to_string();
            cleaned_count += 1;
            cleaned_size += record.size;
        }
    }
    
    // 保存更新后的记录
    if cleaned_count > 0 {
        if let Err(e) = save_history(&storage) {
            return Err(format!("保存历史记录失败: {}", e));
        }
    }
    
    Ok(CleanupResult {
        cleaned_count,
        cleaned_size,
        errors,
    })
}

/// 清理结果结构体
#[derive(Debug, Serialize, Deserialize)]
pub struct CleanupResult {
    /// 清理的记录数量
    pub cleaned_count: u32,
    /// 清理的总大小（字节）
    pub cleaned_size: u64,
    /// 错误信息列表
    pub errors: Vec<String>,
}

/// 获取迁移统计信息
/// 用于设置页面显示已节省的空间等统计数据
#[tauri::command]
fn get_migration_stats() -> Result<MigrationStats, String> {
    let storage = load_history();
    
    let mut total_migrated: u64 = 0;
    let mut active_count: u32 = 0;
    let mut restored_count: u32 = 0;
    let mut app_count: u32 = 0;
    let mut folder_count: u32 = 0;
    
    for record in &storage.records {
        match record.status.as_str() {
            "active" => {
                active_count += 1;
                total_migrated += record.size;
                
                // 统计类型
                if record.record_type == MigrationRecordType::LargeFolder {
                    folder_count += 1;
                } else {
                    app_count += 1;
                }
            }
            "restored" => {
                restored_count += 1;
            }
            _ => {}
        }
    }
    
    Ok(MigrationStats {
        total_space_saved: total_migrated,
        active_migrations: active_count,
        restored_count,
        app_migrations: app_count,
        folder_migrations: folder_count,
    })
}

/// 迁移统计信息结构体
#[derive(Debug, Serialize, Deserialize)]
pub struct MigrationStats {
    /// 总共节省的空间（字节）
    pub total_space_saved: u64,
    /// 当前活跃的迁移数量
    pub active_migrations: u32,
    /// 已恢复的迁移数量
    pub restored_count: u32,
    /// 应用迁移数量
    pub app_migrations: u32,
    /// 文件夹迁移数量
    pub folder_migrations: u32,
}

/// 恢复应用命令
/// 将已迁移的应用恢复到原始位置
/// 
/// # 恢复流程详解
/// 
/// 1. **查找记录**: 根据 ID 查找迁移记录
/// 2. **删除 Junction**: 删除原路径的目录链接
/// 3. **移回文件**: 将文件从目标路径移回原路径
/// 4. **更新记录**: 将记录状态标记为 restored
/// 
/// # 参数
/// - `history_id`: 迁移记录的唯一标识符
/// 
/// # 返回
/// - `MigrationResult`: 恢复结果
#[tauri::command]
fn restore_app(history_id: String) -> Result<MigrationResult, String> {
    #[cfg(windows)]
    {
        // ========== 步骤 1: 查找记录 ==========
        let mut storage = load_history();
        
        let record_index = storage.records
            .iter()
            .position(|r| r.id == history_id && r.status == "active");
        
        let record_index = match record_index {
            Some(i) => i,
            None => return Ok(MigrationResult {
                success: false,
                message: "未找到该迁移记录或已被恢复".to_string(),
                new_path: None,
            }),
        };
        
        let record = storage.records[record_index].clone();
        let original_path = Path::new(&record.original_path);
        let target_path = Path::new(&record.target_path);
        
        // ========== 步骤 2: 验证状态 ==========
        
        // 检查目标路径是否存在（实际文件位置）
        if !target_path.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("目标路径不存在: {}，可能已被手动删除", record.target_path),
                new_path: None,
            });
        }
        
        // 检查原路径是否为符号链接
        // 注意：在 Windows 上，Junction 也被识别为符号链接
        let is_symlink = original_path.symlink_metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        
        if !is_symlink && original_path.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("原路径 {} 不是符号链接，无法恢复", record.original_path),
                new_path: None,
            });
        }
        
        // ========== 步骤 3: 删除 Junction 链接 ==========
        
        if original_path.exists() {
            // 删除符号链接（不会删除目标文件）
            // 在 Windows 上，删除 Junction 使用 remove_dir
            fs::remove_dir(&original_path).map_err(|e| {
                format!("删除符号链接失败: {}。请确保没有程序正在使用该目录。", e)
            })?;
        }
        
        // ========== 步骤 4: 移回文件 ==========
        
        // 使用 fs_extra 移动整个目录
        let mut options = CopyOptions::new();
        options.overwrite = false;
        options.copy_inside = false;
        
        // 获取原路径的父目录
        let original_parent = original_path.parent()
            .ok_or("无法获取原路径的父目录")?;
        
        // 移动目录
        move_dir(&target_path, original_parent, &options).map_err(|e| {
            // 移动失败，尝试恢复 Junction
            let _ = symlink_dir(&target_path, &original_path);
            format!("移动文件失败: {}。已恢复符号链接。", e)
        })?;
        
        // ========== 步骤 5: 更新记录状态 ==========
        
        storage.records[record_index].status = "restored".to_string();
        save_history(&storage)?;
        
        Ok(MigrationResult {
            success: true,
            message: format!(
                "恢复成功！应用 {} 已从 {} 恢复到 {}",
                record.app_name, record.target_path, record.original_path
            ),
            new_path: Some(record.original_path),
        })
    }
    
    #[cfg(not(windows))]
    {
        Ok(MigrationResult {
            success: false,
            message: "恢复功能仅支持 Windows 系统".to_string(),
            new_path: None,
        })
    }
}

/// 在资源管理器中打开指定文件夹
/// 使用 Windows 的 explorer.exe 命令打开目录
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        
        // 检查路径是否存在
        let path_obj = Path::new(&path);
        if !path_obj.exists() {
            return Err(format!("路径不存在: {}", path));
        }
        
        // 使用 explorer.exe 打开文件夹
        // 如果是文件，打开其所在目录并选中该文件
        // 如果是目录，直接打开该目录
        let result = if path_obj.is_dir() {
            Command::new("explorer")
                .arg(&path)
                .spawn()
        } else {
            // 如果是文件，使用 /select 参数选中该文件
            Command::new("explorer")
                .arg("/select,")
                .arg(&path)
                .spawn()
        };
        
        match result {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("打开文件夹失败: {}", e)),
        }
    }
    
    #[cfg(not(windows))]
    {
        Err("此功能仅支持 Windows 系统".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 注册前端可调用的命令
        .invoke_handler(tauri::generate_handler![
            get_installed_apps, 
            get_disk_usage,
            check_process_locks,
            migrate_app,
            uninstall_application,
            scan_app_residue,
            execute_cleanup,
            get_migration_history,
            get_migrated_paths,
            restore_app,
            open_folder,
            get_large_folders,
            get_special_folders_status,
            migrate_large_folder,
            migrate_special_folder,
            restore_large_folder,
            check_link_status,
            clean_ghost_links,
            get_migration_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
