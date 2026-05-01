// OrbitFile - 专业的 Windows 存储重定向工具
// 后端 Rust 模块，提供系统扫描、磁盘信息、应用迁移和历史记录功能

mod app_manager;

use serde::{Deserialize, Serialize};
use sysinfo::Disks;
use tauri::Emitter;
use std::path::{Path, PathBuf};
use std::fs;
use std::io::{Read, Write, Cursor};
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};

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
use fs_extra::dir::{move_dir, CopyOptions, get_size};

// 图标缓存：使用 Mutex 保护的 HashMap 存储已提取的图标
// 键为图标路径，值为 Base64 编码的图标数据
lazy_static::lazy_static! {
    static ref ICON_CACHE: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
}

/// 迁移任务状态（Tauri 托管状态）
/// 用于在前后端之间传递取消信号
pub struct MigrationState {
    /// 取消标志：前端调用 cancel_migration 时设置为 true
    pub cancel_flag: Arc<AtomicBool>,
}

impl Default for MigrationState {
    fn default() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
        }
    }
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

/// 迁移特殊应用目录（含进程预检）
#[tauri::command]
fn migrate_special_folder(
    app_name: String,
    source_path: String,
    target_dir: String,
    state: tauri::State<'_, MigrationState>,
    app_handle: tauri::AppHandle,
) -> Result<MigrationResult, String> {
    state.cancel_flag.store(false, Ordering::SeqCst);
    app_manager::detector::migrate_special_folder(
        app_name,
        source_path,
        target_dir,
        &state.cancel_flag,
        &app_handle,
    )
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
    /// 自定义文件夹（用户手动添加）
    Custom,
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

/// 大文件夹大小更新事件
/// 后台异步计算大小后推送给前端
#[derive(Debug, Clone, Serialize)]
struct LargeFolderSizeEvent {
    folder_id: String,
    size: u64,
}

/// 大文件夹迁移完成事件
/// 迁移在后台线程执行，完成后通过此事件通知前端
#[derive(Debug, Clone, Serialize)]
struct LargeFolderMigrationCompleteEvent {
    success: bool,
    message: String,
    new_path: Option<String>,
}

/// 大文件夹恢复完成事件
/// 恢复在后台线程执行，完成后通过此事件通知前端
#[derive(Debug, Clone, Serialize)]
struct LargeFolderRestoreCompleteEvent {
    success: bool,
    message: String,
    new_path: Option<String>,
}

// ============================================================================
// 数据目录管理
// ============================================================================
//
// 架构说明：
// - 指针文件 %APPDATA%/orbit-file.json 记录实际数据目录路径（仅几十字节）
// - 默认数据目录 %APPDATA%/orbit-file/（与旧版兼容）
// - 用户可在设置中修改数据目录，所有数据文件自动迁移
// - 启动时检测数据目录是否存在，缺失则自动重建空文件
// ============================================================================

/// 数据目录配置（存储在指针文件中）
#[derive(Debug, Serialize, Deserialize)]
struct DataDirConfig {
    data_dir: String,
}

/// 获取指针文件路径
/// 指针文件始终位于 %APPDATA%/orbit-file.json，体积极小
fn get_data_dir_config_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    config_dir.join("orbit-file.json")
}

/// 获取实际数据目录路径
/// 读取指针文件 → 返回配置路径，或使用默认 %APPDATA%/orbit-file/
fn get_data_dir() -> PathBuf {
    let config_path = get_data_dir_config_path();
    if config_path.exists() {
        if let Ok(contents) = std::fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<DataDirConfig>(&contents) {
                let path = PathBuf::from(&config.data_dir);
                if !path.to_string_lossy().is_empty() {
                    return path;
                }
            }
        }
    }
    // 默认路径（与旧版兼容）
    let appdata = std::env::var("APPDATA")
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(appdata).join("orbit-file")
}

/// 确保数据目录存在，缺失则自动重建（防止程序崩溃）
fn ensure_data_dir() -> PathBuf {
    let dir = get_data_dir();
    if !dir.exists() {
        // 启动恢复：目录被删除或迁移中断，自动重建空目录
        let _ = std::fs::create_dir_all(&dir);
    }
    dir
}

/// 获取当前数据目录信息（供前端设置页使用）
#[tauri::command]
fn get_data_dir_info() -> Result<DataDirConfig, String> {
    let dir = get_data_dir();
    Ok(DataDirConfig {
        data_dir: dir.to_string_lossy().to_string(),
    })
}

/// 迁移数据文件从旧目录到新目录
fn migrate_data_files(old_dir: &Path, new_dir: &Path) -> Result<(), String> {
    // 确保新目录存在
    std::fs::create_dir_all(new_dir)
        .map_err(|e| format!("无法创建数据目录: {}", e))?;

    // 需要迁移的数据文件列表
    let data_files = [
        "migration_history.json",
        "migration_history.json.bak",
        "custom_folders.json",
    ];

    for filename in &data_files {
        let old_path = old_dir.join(filename);
        let new_path = new_dir.join(filename);
        if old_path.exists() {
            // 逐个复制文件，大文件不会阻塞（单个 JSON 文件通常 < 10MB）
            std::fs::copy(&old_path, &new_path)
                .map_err(|e| format!("迁移文件失败 {}: {}", filename, e))?;
        }
    }

    Ok(())
}

/// 修改数据目录（Tauri 命令）
/// 将数据文件从旧目录迁移到新目录，更新指针文件
#[tauri::command]
fn set_data_dir(new_path: String) -> Result<String, String> {
    let old_dir = get_data_dir();
    let new_dir = PathBuf::from(&new_path);

    // 相同路径，无需迁移
    if old_dir == new_dir {
        return Ok(new_path);
    }

    // 校验新路径合法性
    if new_path.trim().is_empty() {
        return Err("数据目录路径不能为空".to_string());
    }

    // 创建新目录
    std::fs::create_dir_all(&new_dir)
        .map_err(|e| format!("无法创建数据目录: {}", e))?;

    // 迁移数据文件（仅在旧目录存在时）
    if old_dir.exists() {
        migrate_data_files(&old_dir, &new_dir)?;
    }

    // 原子写入指针文件：先写临时文件，再重命名（防止写入过程中断电损坏配置）
    let config = DataDirConfig { data_dir: new_path.clone() };
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    let config_path = get_data_dir_config_path();
    let temp_config = config_path.with_extension("json.tmp");
    std::fs::write(&temp_config, &json)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;
    std::fs::rename(&temp_config, &config_path)
        .map_err(|e| format!("配置文件重命名失败: {}", e))?;

    Ok(new_path)
}

/// 自定义文件夹持久化条目
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CustomFolderEntry {
    id: String,
    path: String,
    display_name: String,
}

/// 自定义文件夹持久化文件路径
/// 数据目录可在设置中自定义，默认 %APPDATA%/orbit-file/
fn custom_folders_path() -> PathBuf {
    let dir = ensure_data_dir();
    dir.join("custom_folders.json")
}

/// 读取自定义文件夹列表
fn load_custom_folders() -> Vec<CustomFolderEntry> {
    let path = custom_folders_path();
    if !path.exists() {
        return Vec::new();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<CustomFolderEntry>>(&s).ok())
        .unwrap_or_default()
}

/// 保存自定义文件夹列表
fn save_custom_folders(folders: &[CustomFolderEntry]) -> Result<(), String> {
    let path = custom_folders_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    let json = serde_json::to_string_pretty(folders).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&path, &json).map_err(|e| format!("写入失败: {}", e))?;
    Ok(())
}

// ============================================================================
// 应用数据模板管理
// ============================================================================
//
// 模板定义哪些应用的数据目录需要监控，存储在 app_data_templates.json
// 用户可通过编辑此文件增删监控的应用类别，无需修改 Rust 代码
// ============================================================================

/// 应用数据模板条目
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppDataTemplate {
    /// 唯一标识（内置类型对应 detector 模块，如 "wechat", "qq"）
    id: String,
    /// 显示名称
    display_name: String,
    /// 图标标识（前端 iconMap 的 key）
    #[serde(default = "default_icon_id")]
    icon_id: String,
    /// 关联进程名（用于迁移前进程检测）
    #[serde(default = "default_process_names")]
    process_names: Vec<String>,
    /// 可选的固定路径（支持 %VAR% 环境变量展开）
    /// 如果提供，直接使用此路径；否则委托 detector 模块动态检测
    #[serde(default)]
    path: Option<String>,
}

fn default_icon_id() -> String { "folder".to_string() }
fn default_process_names() -> Vec<String> { vec![] }

/// 获取应用数据模板文件路径
fn app_data_templates_path() -> PathBuf {
    let dir = ensure_data_dir();
    dir.join("app_data_templates.json")
}

/// 默认内置模板列表（与旧版硬编码一致，确保向后兼容）
fn default_app_data_templates() -> Vec<AppDataTemplate> {
    vec![
        AppDataTemplate {
            id: "wechat".to_string(),
            display_name: "微信".to_string(),
            icon_id: "wechat".to_string(),
            process_names: vec!["WeChat.exe".to_string()],
            path: None,
        },
        AppDataTemplate {
            id: "wxwork".to_string(),
            display_name: "企业微信".to_string(),
            icon_id: "wxwork".to_string(),
            process_names: vec!["WXWork.exe".to_string()],
            path: None,
        },
        AppDataTemplate {
            id: "qq".to_string(),
            display_name: "QQ".to_string(),
            icon_id: "qq".to_string(),
            process_names: vec!["QQ.exe".to_string()],
            path: None,
        },
        AppDataTemplate {
            id: "dingtalk".to_string(),
            display_name: "钉钉".to_string(),
            icon_id: "dingtalk".to_string(),
            process_names: vec!["DingTalk.exe".to_string()],
            path: None,
        },
        AppDataTemplate {
            id: "feishu".to_string(),
            display_name: "飞书".to_string(),
            icon_id: "feishu".to_string(),
            process_names: vec!["Lark.exe".to_string(), "Feishu.exe".to_string()],
            path: None,
        },
        AppDataTemplate {
            id: "chrome_cache".to_string(),
            display_name: "Chrome 缓存".to_string(),
            icon_id: "chrome_cache".to_string(),
            process_names: vec!["chrome.exe".to_string()],
            path: None,
        },
        AppDataTemplate {
            id: "edge_cache".to_string(),
            display_name: "Edge 缓存".to_string(),
            icon_id: "edge_cache".to_string(),
            process_names: vec!["msedge.exe".to_string()],
            path: None,
        },
        AppDataTemplate {
            id: "vscode_extensions".to_string(),
            display_name: "VS Code 扩展".to_string(),
            icon_id: "vscode_extensions".to_string(),
            process_names: vec!["code.exe".to_string()],
            path: None,
        },
        AppDataTemplate {
            id: "npm_global".to_string(),
            display_name: "npm 全局包".to_string(),
            icon_id: "npm_global".to_string(),
            process_names: vec![],
            path: None,
        },
    ]
}

/// 加载应用数据模板
/// 如果模板文件不存在，自动创建默认模板（向后兼容）
fn load_app_data_templates() -> Vec<AppDataTemplate> {
    let path = app_data_templates_path();
    if !path.exists() {
        let defaults = default_app_data_templates();
        let json = serde_json::to_string_pretty(&defaults).unwrap_or_default();
        let _ = std::fs::write(&path, &json);
        return defaults;
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<AppDataTemplate>>(&s).ok())
        .unwrap_or_else(default_app_data_templates)
}

/// 展开路径中的环境变量（如 %APPDATA%/subdir → C:/Users/.../AppData/Roaming/subdir）
fn expand_env_vars(path_str: &str) -> String {
    let mut result = String::with_capacity(path_str.len());
    let mut remaining = path_str;
    while let Some(start) = remaining.find('%') {
        result.push_str(&remaining[..start]);
        remaining = &remaining[start + 1..];
        if let Some(end) = remaining.find('%') {
            let var_name = &remaining[..end];
            let expanded = std::env::var(var_name).unwrap_or_else(|_| {
                // 变量不存在时保留原文
                format!("%{}%", var_name)
            });
            result.push_str(&expanded);
            remaining = &remaining[end + 1..];
        } else {
            // 孤立的 %，放回去
            result.push('%');
            result.push_str(remaining);
            remaining = "";
            break;
        }
    }
    result.push_str(remaining);
    result
}

/// 保存应用数据模板（Tauri 命令）
/// 用户可通过设置页编辑模板列表
#[tauri::command]
fn save_app_data_templates(templates: Vec<AppDataTemplate>) -> Result<(), String> {
    let path = app_data_templates_path();
    let json = serde_json::to_string_pretty(&templates)
        .map_err(|e| format!("序列化模板失败: {}", e))?;
    std::fs::write(&path, &json)
        .map_err(|e| format!("写入模板文件失败: {}", e))?;
    Ok(())
}

/// 获取应用数据模板（Tauri 命令，供设置页展示和编辑）
#[tauri::command]
fn get_app_data_templates() -> Result<Vec<AppDataTemplate>, String> {
    Ok(load_app_data_templates())
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
fn get_large_folders(app_handle: tauri::AppHandle) -> Result<Vec<LargeFolder>, String> {
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
            size: 0, // 大小由 compute_folder_sizes_async 后台异步计算
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
            size: 0,
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
            size: 0,
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
            size: 0,
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
            size: 0,
            folder_type: LargeFolderType::System,
            is_junction: is_junc,
            junction_target: get_junction_target(&videos),
            app_process_names: vec![],
            icon_id: "videos".to_string(),
            exists: videos.exists(),
        });
    }
    
    // ========== 应用数据文件夹 ==========
    // 从 app_data_templates.json 加载模板（用户可自行增删）
    // 内置类型通过 detector 模块动态检测路径，path 类型直接使用指定路径
    let app_data_templates = load_app_data_templates();

    // 分离内置模板（委托 detector）和路径模板（直接使用）
    let builtin_ids: Vec<String> = app_data_templates.iter()
        .filter(|t| t.path.is_none())
        .map(|t| t.id.clone())
        .collect();

    // 获取 detector 检测结果（仅对内置模板）
    let all_statuses = app_manager::detector::get_special_folders_status()?;

    for template in &app_data_templates {
        if let Some(custom_path) = &template.path {
            // 路径模板：展开环境变量后直接使用
            let expanded = expand_env_vars(custom_path);
            let path = PathBuf::from(&expanded);
            let exists = path.exists() && path.is_dir();
            let is_junc = if exists { is_junction(&path) } else { false };
            folders.push(LargeFolder {
                id: template.id.clone(),
                display_name: template.display_name.clone(),
                path: expanded,
                size: 0,
                folder_type: LargeFolderType::AppData,
                is_junction: is_junc,
                junction_target: if is_junc { get_junction_target(&path) } else { None },
                app_process_names: template.process_names.clone(),
                icon_id: template.icon_id.clone(),
                exists,
            });
        } else if builtin_ids.contains(&template.id) {
            // 内置模板：从 detector 结果中匹配
            let status = match all_statuses.iter().find(|s| s.name == template.id) {
                Some(s) => s,
                None => continue,
            };
            let path = PathBuf::from(&status.current_path);
            let exists = status.is_detected;
            let is_junc = if exists { is_junction(&path) } else { false };
            folders.push(LargeFolder {
                id: status.name.clone(),
                display_name: template.display_name.clone(),
                path: status.current_path.clone(),
                size: 0,
                folder_type: LargeFolderType::AppData,
                is_junction: is_junc,
                junction_target: if is_junc { get_junction_target(&path) } else { None },
                app_process_names: template.process_names.clone(),
                icon_id: template.icon_id.clone(),
                exists,
            });
        }
    }

    // ========== 自定义文件夹 ==========
    let custom = load_custom_folders();
    for cf in &custom {
        let path = PathBuf::from(&cf.path);
        let exists = path.exists();
        let is_junc = if exists { is_junction(&path) } else { false };
        folders.push(LargeFolder {
            id: cf.id.clone(),
            display_name: cf.display_name.clone(),
            path: cf.path.clone(),
            size: 0,
            folder_type: LargeFolderType::Custom,
            is_junction: is_junc,
            junction_target: if is_junc { get_junction_target(&path) } else { None },
            app_process_names: vec![],
            icon_id: "folder".to_string(),
            exists,
        });
    }

    // 按大小降序排序（已迁移的排在后面）
    folders.sort_by(|a, b| {
        if a.is_junction && !b.is_junction {
            return std::cmp::Ordering::Greater;
        }
        if !a.is_junction && b.is_junction {
            return std::cmp::Ordering::Less;
        }
        let type_order = |t: &LargeFolderType| match t {
            LargeFolderType::System => 0,
            LargeFolderType::AppData => 1,
            LargeFolderType::Custom => 2,
        };
        type_order(&a.folder_type).cmp(&type_order(&b.folder_type))
    });

    // 后台异步计算各文件夹大小，通过 "large-folder-size" 事件推送给前端
    compute_folder_sizes_async(app_handle.clone(), folders.clone());

    Ok(folders)
}

/// 后台异步计算各文件夹大小并通过事件推送
/// 调用方式：get_large_folders 返回后 spawn 此函数
fn compute_folder_sizes_async(app_handle: tauri::AppHandle, folders: Vec<LargeFolder>) {
    std::thread::spawn(move || {
        for folder in &folders {
            if !folder.exists || folder.is_junction {
                continue;
            }
            let path = PathBuf::from(&folder.path);
            let size = get_folder_size(&path);
            if size > 0 {
                let _ = app_handle.emit("large-folder-size", LargeFolderSizeEvent {
                    folder_id: folder.id.clone(),
                    size,
                });
            }
        }
    });
}

/// 迁移大文件夹
/// 耗时操作在后台线程执行，通过 "large-folder-migration-complete" 事件通知前端结果
/// 迁移过程中通过 "migration-progress" 事件推送进度
#[tauri::command]
fn migrate_large_folder(
    source_path: String,
    target_dir: String,
    state: tauri::State<'_, MigrationState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // 基础校验（同步执行，快速失败）
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err(format!("源路径不存在: {}", source_path));
    }
    if !source.is_dir() {
        return Err("源路径必须是一个目录".to_string());
    }

    let folder_name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // 重置取消标志
    state.cancel_flag.store(false, Ordering::SeqCst);
    let cancel_flag = state.cancel_flag.clone();
    let handle = app_handle.clone();

    // 耗时 IO 操作放入独立线程，避免阻塞 Tauri 线程池
    std::thread::spawn(move || {
        let result = app_manager::migration::migrate_app(
            folder_name,
            source_path,
            target_dir,
            &cancel_flag,
            &handle,
        );

        let event = match result {
            Ok(r) => LargeFolderMigrationCompleteEvent {
                success: r.success,
                message: r.message,
                new_path: r.new_path,
            },
            Err(e) => LargeFolderMigrationCompleteEvent {
                success: false,
                message: e,
                new_path: None,
            },
        };
        let _ = handle.emit("large-folder-migration-complete", event);
    });

    Ok(())
}

/// 添加自定义文件夹
/// 将用户选择的文件夹路径持久化到 custom_folders.json
#[tauri::command]
fn add_custom_folder(path: String) -> Result<(), String> {
    let folder_path = PathBuf::from(&path);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err(format!("路径不存在或不是文件夹: {}", path));
    }

    let display_name = folder_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    // 生成唯一 ID（基于路径字符串的简单哈希）
    let hash: u64 = path.as_bytes().iter().enumerate()
        .fold(0u64, |acc, (i, &b)| acc.wrapping_add((b as u64).wrapping_mul(i as u64 + 1)));
    let id = format!("custom_{:x}", hash);

    let mut custom = load_custom_folders();
    // 防止重复添加
    if custom.iter().any(|c| c.path.to_lowercase() == path.to_lowercase()) {
        return Err("该文件夹已在列表中".to_string());
    }

    custom.push(CustomFolderEntry {
        id,
        path,
        display_name,
    });

    save_custom_folders(&custom)
}

/// 删除自定义文件夹
#[tauri::command]
fn remove_custom_folder(id: String) -> Result<(), String> {
    let mut custom = load_custom_folders();
    let before = custom.len();
    custom.retain(|c| c.id != id);
    if custom.len() == before {
        return Err("未找到该自定义文件夹".to_string());
    }
    save_custom_folders(&custom)
}

/// 恢复大文件夹（从 Junction 恢复到原位置）
/// 耗时部分在后台线程执行，通过 "large-folder-restore-complete" 事件通知前端
#[tauri::command]
fn restore_large_folder(
    junction_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let junction = PathBuf::from(&junction_path);

        // 快速校验（同步执行）
        if !is_junction(&junction) {
            return Err("该路径不是一个符号链接，无法恢复".to_string());
        }

        let target_path = match get_junction_target(&junction) {
            Some(target) => PathBuf::from(target),
            None => return Err("无法读取符号链接的目标路径".to_string()),
        };

        if !target_path.exists() {
            return Err(format!("目标路径不存在: {}", target_path.to_string_lossy()));
        }

        // 耗时 IO（删除 Junction + 移动文件夹）放入独立线程
        let handle = app_handle.clone();
        let target_path_str = target_path.to_string_lossy().to_string();
        std::thread::spawn(move || {
            let result = restore_large_folder_inner(&junction, &target_path_str);
            let event = match &result {
                Ok(r) => LargeFolderRestoreCompleteEvent {
                    success: r.success,
                    message: r.message.clone(),
                    new_path: r.new_path.clone(),
                },
                Err(e) => LargeFolderRestoreCompleteEvent {
                    success: false,
                    message: e.clone(),
                    new_path: None,
                },
            };
            let _ = handle.emit("large-folder-restore-complete", event);
        });

        Ok(())
    }

    #[cfg(not(windows))]
    {
        Err("此功能仅支持 Windows 系统".to_string())
    }
}

/// 恢复大文件夹的内部逻辑（在后台线程中执行）
/// 包含：删除 Junction → 移动文件夹 → 更新迁移记录
fn restore_large_folder_inner(
    junction_path: &Path,
    target_str: &str,
) -> Result<MigrationResult, String> {
    let target_path = PathBuf::from(target_str);
    let junction = junction_path;

    // 步骤 1: 删除 Junction
    fs::remove_dir(junction).map_err(|e| {
        format!("无法删除符号链接: {}", e)
    })?;

    // 步骤 2: 移动文件夹回原位置
    let mut options = CopyOptions::new();
    options.overwrite = false;
    options.copy_inside = false;

    let original_parent = junction.parent()
        .ok_or("无法获取原路径的父目录")?;

    move_dir(&target_path, original_parent, &options).map_err(|e| {
        // 移动失败，尝试恢复 Junction（回滚）
        #[cfg(windows)]
        let _ = symlink_dir(&target_path, junction);
        format!("移动文件夹失败: {}。已恢复符号链接。", e)
    })?;

    // 步骤 3: 更新迁移记录状态
    let junction_str = junction.to_string_lossy().to_string();
    if let Err(e) = update_migration_record_status(&junction_str, "restored") {
        eprintln!("警告: 更新迁移记录状态失败: {}", e);
    }

    Ok(MigrationResult {
        success: true,
        message: format!("恢复成功！文件夹已恢复到 {}", junction_str),
        new_path: Some(junction_str),
    })
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
/// 2. **进度上报**: 通过 `migration-progress` 事件实时推送复制进度
/// 3. **逐个复制**: 遍历源目录文件列表，逐个复制并上报百分比
/// 4. **完整性校验**: 比较源和目标文件夹的总大小是否一致
/// 5. **备份原目录**: 将原始源目录重命名为 xxx_backup
/// 6. **创建 Junction**: 在原路径创建指向新位置的目录联接
/// 7. **清理备份**: 迁移成功后删除备份目录
/// 8. **回滚机制**: 任何步骤失败都会尝试恢复原状态
/// 9. **取消支持**: 前端可随时调用 cancel_migration 中断迁移
///
/// # 参数
/// - `app_name`: 应用名称（用于记录历史）
/// - `source`: 源路径（应用原安装位置）
/// - `target_parent`: 目标父目录（用户选择的目标文件夹）
#[tauri::command]
fn migrate_app(
    app_name: String,
    source: String,
    target_parent: String,
    state: tauri::State<'_, MigrationState>,
    app_handle: tauri::AppHandle,
) -> Result<MigrationResult, String> {
    // 每次迁移开始前重置取消标志
    state.cancel_flag.store(false, Ordering::SeqCst);

    app_manager::migration::migrate_app(
        app_name,
        source,
        target_parent,
        &state.cancel_flag,
        &app_handle,
    )
}

/// 取消正在进行的迁移任务
///
/// 设置取消标志后，迁移流程会在下一个检查点停止并回滚
#[tauri::command]
fn cancel_migration(state: tauri::State<'_, MigrationState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

/// 预览卸载命令（不执行）
/// 供前端在确认对话框中展示即将运行的卸载命令
#[tauri::command]
fn preview_uninstall(input: app_manager::uninstaller::UninstallInput) -> Result<app_manager::uninstaller::UninstallPreview, String> {
    app_manager::uninstaller::preview_uninstall(input)
}

/// 强制删除应用（跳过卸载器）
/// 用于卸载程序已损坏/缺失的场景
#[tauri::command]
fn force_remove_application(input: app_manager::uninstaller::UninstallInput) -> Result<app_manager::uninstaller::UninstallResult, String> {
    app_manager::uninstaller::force_remove_application(input)
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
/// 数据目录可在设置中自定义，默认 %APPDATA%/orbit-file/
fn get_history_file_path() -> PathBuf {
    let dir = ensure_data_dir();
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
/// 在文件资源管理器中打开数据目录
#[tauri::command]
fn open_data_dir() -> Result<(), String> {
    let data_dir = ensure_data_dir();
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(data_dir.to_string_lossy().as_ref())
            .spawn()
            .map_err(|e| format!("无法打开资源管理器: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(data_dir.to_string_lossy().as_ref())
            .spawn()
            .map_err(|e| format!("无法打开文件管理器: {}", e))?;
    }
    Ok(())
}

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
        // 注册托管状态
        .manage(MigrationState::default())
        // 注册前端可调用的命令
        .invoke_handler(tauri::generate_handler![
            get_data_dir_info,
            set_data_dir,
            get_app_data_templates,
            save_app_data_templates,
            get_installed_apps,
            get_disk_usage,
            check_process_locks,
            migrate_app,
            cancel_migration,
            preview_uninstall,
            force_remove_application,
            uninstall_application,
            scan_app_residue,
            execute_cleanup,
            get_migration_history,
            get_migrated_paths,
            restore_app,
            open_folder,
            get_large_folders,
            migrate_large_folder,
            migrate_special_folder,
            add_custom_folder,
            remove_custom_folder,
            restore_large_folder,
            check_link_status,
            clean_ghost_links,
            open_data_dir,
            get_migration_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
