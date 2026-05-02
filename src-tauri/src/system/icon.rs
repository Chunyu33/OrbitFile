// Windows 可执行文件图标提取模块
// 使用 Win32 API 从 .exe/.dll 中提取图标，编码为 Base64 PNG 供前端渲染

use std::path::Path;
use std::io::Cursor;
use std::collections::HashMap;
use std::sync::Mutex;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};
#[cfg(windows)]
use windows::Win32::UI::Shell::ExtractIconExW;
#[cfg(windows)]
use windows::Win32::Graphics::Gdi::{
    GetDIBits, CreateCompatibleDC, DeleteDC, SelectObject, GetObjectW,
    BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject,
};
#[cfg(windows)]
use windows::core::PCWSTR;

// 图标缓存：键为图标路径（如 "C:\app.exe,0"），值为 Base64 编码的 PNG
lazy_static::lazy_static! {
    static ref ICON_CACHE: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
}

/// 解析图标路径，分离文件路径和图标索引
///
/// # 示例
/// - "C:\app.exe" -> ("C:\app.exe", 0)
/// - "C:\app.exe,0" -> ("C:\app.exe", 0)
/// - "C:\app.exe,-101" -> ("C:\app.exe", -101)
#[cfg(windows)]
fn parse_icon_path(icon_path: &str) -> (String, i32) {
    let path = icon_path.trim().trim_matches('"');

    if let Some(comma_pos) = path.rfind(',') {
        let file_part = &path[..comma_pos];
        let index_part = &path[comma_pos + 1..];
        if let Ok(index) = index_part.trim().parse::<i32>() {
            return (file_part.trim().trim_matches('"').to_string(), index);
        }
    }

    (path.trim_matches('"').to_string(), 0)
}

/// 将 HICON 图标句柄转换为 Base64 编码的 PNG 数据
///
/// # 技术实现
/// 1. GetIconInfo — 获取图标的颜色位图和掩码位图
/// 2. GetDIBits — 将位图转换为 BGRA 像素数据
/// 3. BGRA → RGBA 转换
/// 4. image crate 编码为 PNG → base64 编码
#[cfg(windows)]
fn icon_to_base64(icon: windows::Win32::UI::WindowsAndMessaging::HICON) -> String {
    unsafe {
        let mut icon_info = ICONINFO::default();
        if GetIconInfo(icon, &mut icon_info).is_err() {
            return String::new();
        }

        let hbm_color = icon_info.hbmColor;
        if hbm_color.is_invalid() {
            if !icon_info.hbmMask.is_invalid() { let _ = DeleteObject(icon_info.hbmMask); }
            return String::new();
        }

        // 获取位图尺寸
        let mut bitmap = BITMAP::default();
        let bitmap_size = std::mem::size_of::<BITMAP>() as i32;
        if GetObjectW(hbm_color, bitmap_size, Some(&mut bitmap as *mut _ as *mut _)) == 0 {
            let _ = DeleteObject(hbm_color);
            if !icon_info.hbmMask.is_invalid() { let _ = DeleteObject(icon_info.hbmMask); }
            return String::new();
        }

        let width = bitmap.bmWidth as u32;
        let height = bitmap.bmHeight as u32;

        // 限制图标大小，防止处理异常大图标
        if width == 0 || height == 0 || width > 256 || height > 256 {
            let _ = DeleteObject(hbm_color);
            if !icon_info.hbmMask.is_invalid() { let _ = DeleteObject(icon_info.hbmMask); }
            return String::new();
        }

        // 创建设备上下文并选择位图
        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            let _ = DeleteObject(hbm_color);
            if !icon_info.hbmMask.is_invalid() { let _ = DeleteObject(icon_info.hbmMask); }
            return String::new();
        }

        let old_bitmap = SelectObject(hdc, hbm_color);

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // 负值 = 自上而下
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [windows::Win32::Graphics::Gdi::RGBQUAD::default(); 1],
        };

        let pixel_count = (width * height) as usize;
        let mut pixels: Vec<u8> = vec![0; pixel_count * 4];

        let result = GetDIBits(
            hdc, hbm_color, 0, height,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi, DIB_RGB_COLORS,
        );

        // 清理 GDI 资源
        SelectObject(hdc, old_bitmap);
        let _ = DeleteDC(hdc);
        let _ = DeleteObject(hbm_color);
        if !icon_info.hbmMask.is_invalid() { let _ = DeleteObject(icon_info.hbmMask); }

        if result == 0 { return String::new(); }

        // BGRA → RGBA
        for i in 0..pixel_count {
            let offset = i * 4;
            pixels.swap(offset, offset + 2);
        }

        // 编码为 PNG Base64
        match image::RgbaImage::from_raw(width, height, pixels) {
            Some(img) => {
                let mut png_data = Cursor::new(Vec::new());
                if img.write_to(&mut png_data, image::ImageFormat::Png).is_ok() {
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

/// 从 EXE/DLL 文件中提取图标并转换为 Base64 编码的 PNG
///
/// # 技术实现
/// 1. ExtractIconExW — 从可执行文件中提取图标句柄
/// 2. icon_to_base64 — 将图标转换为 Base64 PNG
/// 3. 结果缓存到 ICON_CACHE，避免重复提取
///
/// # 参数
/// - `icon_path`: 图标路径，可能包含索引（如 "C:\app.exe,0"）
///
/// # 返回
/// - 成功时返回 `data:image/png;base64,...` 格式字符串
/// - 失败时返回空字符串
#[cfg(windows)]
pub fn extract_icon_to_base64(icon_path: &str) -> String {
    // 检查缓存
    if let Ok(cache) = ICON_CACHE.lock() {
        if let Some(cached) = cache.get(icon_path) {
            return cached.clone();
        }
    }

    let (file_path, icon_index) = parse_icon_path(icon_path);

    if !Path::new(&file_path).exists() {
        return String::new();
    }

    let wide_path: Vec<u16> = file_path
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut large_icon = windows::Win32::UI::WindowsAndMessaging::HICON::default();

        let result = ExtractIconExW(
            PCWSTR::from_raw(wide_path.as_ptr()),
            icon_index,
            Some(&mut large_icon),
            None,
            1,
        );

        if result == 0 || large_icon.is_invalid() {
            return String::new();
        }

        let base64_result = icon_to_base64(large_icon);
        let _ = DestroyIcon(large_icon);

        // 缓存成功结果
        if !base64_result.is_empty() {
            if let Ok(mut cache) = ICON_CACHE.lock() {
                cache.insert(icon_path.to_string(), base64_result.clone());
            }
        }

        base64_result
    }
}

/// 非 Windows 平台的图标提取占位函数
#[cfg(not(windows))]
pub fn extract_icon_to_base64(_icon_path: &str) -> String {
    String::new()
}
