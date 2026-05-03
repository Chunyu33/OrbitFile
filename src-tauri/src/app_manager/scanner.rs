// 应用扫描模块
// 负责扫描已安装应用与进程占用检测
//
// 设计说明（中文）：
// 1. 注册表扫描（原实现保留）：遍历 HKLM/HKCU 下的 Uninstall 键获取结构化信息
// 2. DisplayIcon 回退：当 InstallLocation 缺失时，尝试从 DisplayIcon / UninstallString 推导安装目录，
//    覆盖 ComfyUI、部分便携安装器等只写入图标路径的场景
// 3. 文件系统扫描（增强）：扫描 Program Files、Program Files (x86)、LocalAppData（含 Programs 子目录）以及
//    所有非系统盘的顶层与二级目录，识别"目录内含 exe / bat / cmd"的便携/绿色应用
//    覆盖 Squirrel 安装器（Electron 应用）直接安装到 %LOCALAPPDATA%\<appname> 的场景
//    按规范化路径严格去重，不覆盖已由注册表获得的条目

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::models::{InstalledApp, ProcessLockResult};
use sysinfo::System;
#[cfg(windows)]
use walkdir::WalkDir;

/// 注册表扫描结果缓存 TTL（秒）
const REGISTRY_CACHE_TTL_SECS: u64 = 30;

lazy_static::lazy_static! {
    static ref REGISTRY_CACHE: std::sync::Mutex<Option<(Instant, Vec<InstalledApp>)>> =
        std::sync::Mutex::new(None);
}

#[cfg(windows)]
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
#[cfg(windows)]
use winreg::RegKey;
#[cfg(windows)]
use winreg::HKEY;

/// 规范化路径：去除末尾分隔符、转小写，用于跨来源去重
fn normalize_path(path: &str) -> String {
    let trimmed = path.trim().trim_matches('"');
    let without_tail = trimmed.trim_end_matches(['\\', '/']);
    without_tail.to_lowercase()
}

/// 从 DisplayIcon / UninstallString 字段尝试推导安装目录
/// 形式如 "C:\path\app.exe,0" 或 "\"C:\path\uninst.exe\" /S"
#[cfg(windows)]
fn derive_install_location_from_icon(icon_or_uninstall: &str) -> Option<String> {
    let raw = icon_or_uninstall.trim();
    if raw.is_empty() {
        return None;
    }

    // 1) 先按逗号分割去掉 ",索引" 后缀（如 "C:\app.exe,0"），再处理引号/无引号路径
    let (before_comma, _) = raw.split_once(',').unwrap_or((raw, ""));
    let before_comma = before_comma.trim();

    // 2) 提取实际存在的路径：引号直接提取，无引号需逐词拼接试探空格路径
    let candidate = if before_comma.starts_with('"') {
        before_comma.trim_matches('"').to_string()
    } else {
        // 无引号路径可能含空格（如 C:\Program Files\App\app.exe）
        // 从最长空格前缀递减试探，找到第一个存在的文件/目录
        let tokens: Vec<&str> = before_comma.split_whitespace().collect();
        let mut found = None;
        for i in (1..=tokens.len()).rev() {
            let joined = tokens[..i].join(" ");
            if Path::new(&joined).exists() {
                found = Some(joined);
                break;
            }
        }
        found?
    };

    let p = Path::new(&candidate);
    if !p.exists() {
        return None;
    }

    // 若候选路径是文件，返回其父目录；若是目录，直接使用
    let dir = if p.is_file() {
        p.parent()?.to_path_buf()
    } else {
        p.to_path_buf()
    };

    // 过滤掉系统/无意义目录（如 C:\Windows\system32）
    let lower = dir.to_string_lossy().to_lowercase();
    if lower.contains("\\windows\\system32")
        || lower.contains("\\windows\\syswow64")
        || lower.contains("\\common files\\")
    {
        return None;
    }

    Some(dir.to_string_lossy().to_string())
}

/// 判断文件名是否看起来像安装包/卸载器/更新器而非主程序
/// 规则（全小写匹配）：
/// - 显性字样：setup / install / uninstall / unins / update
/// - 版本化架构后缀：_x64.exe / _x86.exe / _win64.exe / _win32.exe
#[cfg(windows)]
fn is_installer_like_exe(file_name_lower: &str) -> bool {
    if file_name_lower.contains("setup")
        || file_name_lower.contains("install") // 同时覆盖 installer
        || file_name_lower.contains("unins")
        || file_name_lower.contains("update")  // Squirrel 更新器 (Update.exe)
    {
        return true;
    }
    // 架构后缀常见于安装包
    if file_name_lower.ends_with("_x64.exe")
        || file_name_lower.ends_with("_x86.exe")
        || file_name_lower.ends_with("_win64.exe")
        || file_name_lower.ends_with("_win32.exe")
        || file_name_lower.ends_with(".msi")
    {
        return true;
    }
    false
}

/// 判断是否为开发/构建目录，深度扫描时跳过以提升性能
#[cfg(windows)]
fn is_dev_directory(name: &str) -> bool {
    const DEV_DIRS: &[&str] = &[
        "node_modules", ".git", "target", "dist", "build",
        "__pycache__", ".venv", "venv", ".idea", ".vs",
        "vendor", "bower_components", ".cache", "obj",
        "debug", "release", "packages",
    ];
    let lower = name.to_lowercase();
    DEV_DIRS.iter().any(|d| &lower == d)
}

/// 判断是否为 IDE/应用自带的捆绑运行时目录（应完全跳过扫描）
#[cfg(windows)]
fn is_bundled_runtime_dir(name: &str) -> bool {
    const RUNTIMES: &[&str] = &[
        "jbr", "jre", "jdk", "rt",
        "gradle", "maven",
    ];
    let lower = name.to_lowercase();
    RUNTIMES.iter().any(|r| &lower == r)
}

/// 综合判断：目录是否应完全跳过（开发目录 + 捆绑运行时）
#[cfg(windows)]
fn is_skippable_dir(name: &str) -> bool {
    is_dev_directory(name) || is_bundled_runtime_dir(name)
}

/// 判断目录名是否为“绝对不可能是应用标识”的结构性名称
/// 这些目录本身绝不能被注册为应用，即使在内部找到了 exe
/// ——必须向上重定向到父目录，找不到有效父目录则丢弃
#[cfg(windows)]
fn is_never_app_dir(name: &str) -> bool {
    const NEVER_APP: &[&str] = &[
        "bin", "lib", "libs", "include",
        "sdk", "tools", "runtime", "runtimes",
    ];
    let lower = name.to_lowercase();
    NEVER_APP.iter().any(|n| &lower == n)
}

/// 判断子目录名是否为应用的支撑目录（resources、locales 等）
/// 用于旁证：当前目录是一个完整应用而非仅有裸 exe 的文件堆放处
#[cfg(windows)]
fn is_supporting_subdir(name: &str) -> bool {
    const SUPPORT_DIRS: &[&str] = &[
        "resources", "locales", "platforms", "translations",
        "data", "lib", "bin", "plugins", "modules",
        "languages", "help", "docs", "assets", "static",
        "config", "tools", "runtime", "scripts",
    ];
    let lower = name.to_lowercase();
    SUPPORT_DIRS.iter().any(|d| &lower == d)
}

/// 向下一层子目录搜索匹配父目录名的 exe
/// 用于处理 exe 在 bin/app/x64 等结构性子目录中的应用：
///   E:\app\SomeApp\bin\SomeApp.exe  → 返回 SomeApp.exe
/// 仅在顶层有支撑证据（DLL/配置/支撑子目录）时才调用
#[cfg(windows)]
fn find_deep_exe_matching_parent(dir: &Path, parent_name_lower: &str) -> Option<PathBuf> {
    // 优先探查 bin/（最常见的主 exe 位置），再探查其他结构性子目录
    let bin_dir = dir.join("bin");
    if bin_dir.exists() {
        if let Some(exe) = try_find_exe_in_dir(&bin_dir, parent_name_lower) {
            return Some(exe);
        }
    }

    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let sub_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        // 跳过 bin（已优先检查）和非结构性目录
        if sub_name.eq_ignore_ascii_case("bin") || !is_structural_or_support_dir(sub_name) {
            continue;
        }
        if let Some(exe) = try_find_exe_in_dir(&path, parent_name_lower) {
            return Some(exe);
        }
    }
    None
}

/// 在指定目录中查找匹配父目录名的 exe
#[cfg(windows)]
fn try_find_exe_in_dir(sub_dir: &Path, parent_name_lower: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(sub_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !ext.eq_ignore_ascii_case("exe") {
            continue;
        }
        let file_name_lower = path
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if is_installer_like_exe(&file_name_lower) {
            continue;
        }
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if stem == *parent_name_lower || parent_name_lower.contains(&stem) {
            return Some(path);
        }
    }
    None
}

/// 当 exe 在结构性子目录（bin/app/x64 等）中被发现时，
/// 尝试向上查找真正的应用根目录
/// 必要条件：exe 名与父目录名匹配
/// 找不到有效父目录时返回 None —— 调用方必须丢弃此候选，绝不回退到结构子目录自身
#[cfg(windows)]
fn resolve_app_root_from_structural(dir: &Path, exe_path: &Path) -> Option<PathBuf> {
    let exe_stem = exe_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mut current = dir.to_path_buf();
    while let Some(parent) = current.parent() {
        // 到达磁盘根（如 E:\）则停止
        if parent.parent().is_none() {
            break;
        }
        let parent_name = parent
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.to_lowercase())
            .unwrap_or_default();
        if parent_name.is_empty() {
            break;
        }
        // 父目录仍是结构性名称 → 继续向上
        if is_structural_or_support_dir(&parent_name) {
            current = parent.to_path_buf();
            continue;
        }
        // 非结构性父目录：检查 exe 名是否与父目录名匹配
        if exe_stem == parent_name || parent_name.contains(&exe_stem) || exe_stem.contains(&parent_name) {
            return Some(parent.to_path_buf());
        }
        // exe 名不匹配 → 父目录不是此应用的正确标识，放弃
        break;
    }
    // 没有找到有效的父目录 → 丢弃（外部会继续向下扫描）
    None
}

/// 判断目录名是否为结构性/支撑性名称（bin、app、x64 等）
/// 这些目录本身不是应用，而是应用的内部结构
#[cfg(windows)]
fn is_structural_or_support_dir(name: &str) -> bool {
    is_supporting_subdir(name)
        || is_never_app_dir(name) // bin/lib/tools 等也属于结构性目录
        || {
            const STRUCTURAL: &[&str] = &[
                "app", "application", "program",
                "x64", "x86", "win64", "win32", "ia32",
                "portable", "standalone",
            ];
            let lower = name.to_lowercase();
            STRUCTURAL.iter().any(|s| &lower == s)
        }
}

/// exe 名与目录名的匹配程度
#[derive(Debug, Clone, Copy)]
enum NameMatchKind {
    /// 精确匹配：exe stem == dir name（如 WeChat/WeChat.exe）
    Exact,
    /// 包含匹配：一个包含另一个（如 Everything-1.4/Everything.exe）
    Contains,
    /// 无匹配
    None,
}

/// 评分阈值：score >= 0.35 即可认定为应用（宽松模式，提高召回率）
/// 设计保证：
/// - 裸 exe (+0.30) + 路径语义 (+0.10) = 0.40 → 单独通过
/// - 安装包 exe (+0.30) + 路径 (+0.10) - 安装包惩罚 (-0.15) = 0.25 → 不通过（需旁证）
/// - 精确名称匹配 (+0.35) + 基础 exe (+0.30) + 路径 (+0.10) = 0.75 → 高分通过
/// 阈值从 0.60 降至 0.35，避免过度过滤导致真实应用漏报
const SCORE_THRESHOLD: f32 = 0.35;

/// 对候选应用 exe 进行评分（0.0 ~ 1.0）
///
/// 正向信号权重（两阶段模型-阶段2：轻量评分，主要用于排序，不过度过滤）：
/// | 信号 | 权重 | 说明 |
/// |------|------|------|
/// | exe 存在（基础分） | +0.30 | 核心信号，exe 存在即有基本分 |
/// | exe 名与目录名精确匹配 | +0.35 | 名称匹配仍为重要正向信号 |
/// | exe 名与目录名包含匹配 | +0.25 | 弱于精确匹配 |
/// | 目录含 DLL | +0.15 | C++/原生应用常见旁证 |
/// | 目录含配置文件 (ini/xml/json...) | +0.10 | 按装/便携应用旁证 |
/// | 目录含支撑子目录 (resources/locales...) | +0.10 | 完整应用结构旁证 |
/// | 目录含多个 exe | +0.05 | 应用套件弱信号 |
/// | 路径语义（非下载/临时目录） | +0.10 | 防止安装包被误识别 |
///
/// 负向信号（轻量，不"一票否决"）：
/// | 信号 | 权重 | 说明 |
/// |------|------|------|
/// | exe 为安装包/卸载器/更新器 | -0.15 | 减分但不直接跳过（由阶段1纯安装包目录检查负责） |
#[cfg(windows)]
fn score_application_candidate(
    exe_path: &Path,
    has_dll: bool,
    has_config: bool,
    has_supporting_subdirs: bool,
    exe_count: u32,
    name_match: NameMatchKind,
) -> f32 {
    let mut score: f32 = 0.0;

    // 基础分：exe 存在即为应用的有力证据
    score += 0.30;

    // 路径语义：exe 不在下载目录即为正常安装路径
    let exe_lower = exe_path.to_string_lossy().to_lowercase();
    let in_downloads = (*DOWNLOADS_DIR_LOWER)
        .as_ref()
        .map(|dl| exe_lower.starts_with(dl.as_str()))
        .unwrap_or(false);
    if !in_downloads {
        score += 0.10;
    }

    if has_dll {
        score += 0.15;
    }
    if has_config {
        score += 0.10;
    }
    if has_supporting_subdirs {
        score += 0.10;
    }
    if exe_count >= 2 {
        score += 0.05;
    }

    // 名称匹配仍为重要正向信号（权重已降低，避免过度依赖）
    match name_match {
        NameMatchKind::Exact => score += 0.35,
        NameMatchKind::Contains => score += 0.25,
        NameMatchKind::None => {}
    }

    // 上限 1.0，防止多项叠加后溢出
    score = score.min(1.0);

    // 安装包/卸载器特征 → 轻量减分（不再一票否决）
    let file_name_lower = exe_path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if is_installer_like_exe(&file_name_lower) {
        score -= 0.15;
    }

    score
}

/// 判断目录是否"看起来像一个应用目录"
/// 两阶段模型：
///
/// 阶段1（宽松识别）：
/// - 只要目录中有 exe / bat / cmd
/// - 且不是"纯安装包目录"（只有 installer exe + 无 dll/config/子目录）
/// → 即可作为候选应用
///
/// 阶段2（轻量评分）：
/// - 对所有 exe 候选评分，选取最高分
/// - score >= 0.35 即可返回
/// - 评分同时用于选择最佳主 exe
#[cfg(windows)]
fn directory_looks_like_app(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut exe_candidates: Vec<PathBuf> = Vec::new();
    let mut best_launcher: Option<PathBuf> = None;
    let mut has_non_installer_exe = false;
    let mut has_dll = false;
    let mut has_config = false;
    let mut has_supporting_subdirs = false;
    let mut exe_count: u32 = 0;
    let dir_name_lower = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if is_supporting_subdir(name) {
                    has_supporting_subdirs = true;
                }
            }
            continue;
        }

        if !path.is_file() {
            continue;
        }
        let file_name_lower = path
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            match ext.to_lowercase().as_str() {
                "exe" => {
                    exe_count += 1;
                    // 阶段1 宽松策略：安装包/卸载器 exe 也纳入候选（不再硬跳过）
                    // 评分函数中的 -0.15 惩罚足以区分优先级
                    if !is_installer_like_exe(&file_name_lower) {
                        has_non_installer_exe = true;
                    }
                    exe_candidates.push(path);
                }
                "dll" => has_dll = true,
                "bat" | "cmd" => {
                    if best_launcher.is_none() {
                        best_launcher = Some(path);
                    }
                }
                "ini" | "xml" | "json" | "cfg" | "conf" | "toml" | "yaml" | "yml" => {
                    has_config = true;
                }
                _ => {}
            }
        }
    }

    // 阶段1 纯安装包目录检查：
    // 只有 installer exe，且无 bat/cmd、无 dll、无 config、无支撑子目录 → 判定为安装包目录
    let is_pure_installer_dir = !has_non_installer_exe
        && best_launcher.is_none()
        && !has_dll
        && !has_config
        && !has_supporting_subdirs
        && exe_count > 0;

    if is_pure_installer_dir {
        orbit_log!(
            "DEBUG", "scanner",
            "filtered: installer_only dir={} ({} exe(s), no supporting evidence)",
            dir.display(),
            exe_count
        );
        return None;
    }

    // 阶段2：对所有 exe 候选评分，取最高分
    let mut best_exe: Option<PathBuf> = None;
    let mut best_score: f32 = 0.0;

    for exe_path in &exe_candidates {
        let stem = exe_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let name_match = if stem == dir_name_lower {
            NameMatchKind::Exact
        } else if !stem.is_empty()
            && !dir_name_lower.is_empty()
            && (dir_name_lower.contains(&stem) || stem.contains(&dir_name_lower))
        {
            NameMatchKind::Contains
        } else {
            NameMatchKind::None
        };

        let score = score_application_candidate(
            exe_path,
            has_dll,
            has_config,
            has_supporting_subdirs,
            exe_count,
            name_match,
        );

        if score > best_score {
            best_score = score;
            best_exe = Some(exe_path.clone());
        }
    }

    if best_score >= SCORE_THRESHOLD {
        return best_exe;
    }

    // 阶段2 未达阈值但有支撑证据 → 向深层搜索名称匹配 exe
    if has_dll || has_config || has_supporting_subdirs {
        if let Some(exe) = find_deep_exe_matching_parent(dir, &dir_name_lower) {
            return Some(exe);
        }
    }

    // bat/cmd 宽松回退：只要存在即可返回（纯安装包目录已在阶段1排除）
    if let Some(p) = best_launcher {
        return Some(p);
    }

    orbit_log!(
        "DEBUG", "scanner",
        "filtered: low_score dir={} best_score={:.2} threshold={:.2}",
        dir.display(),
        best_score,
        SCORE_THRESHOLD
    );
    None
}

lazy_static::lazy_static! {
    /// 缓存的下载目录路径（通过 SHGetKnownFolderPath 获取，支持用户重新映射）
    static ref DOWNLOADS_DIR_LOWER: Option<String> =
        dirs::download_dir().map(|p| p.to_string_lossy().to_lowercase());
}

/// 路径是否属于应当跳过的系统/空/下载目录
#[cfg(windows)]
fn is_blacklisted_path(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_lowercase();
    const BLACKLIST: &[&str] = &[
        "windows",
        "$recycle.bin",
        "system volume information",
        "programdata",
        "recovery",
        "perflogs",
        "msocache",
        "config.msi",
    ];
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        let nl = name.to_lowercase();
        if BLACKLIST.iter().any(|b| &nl == b) {
            return true;
        }
    }
    // 跳过下载目录（含用户自定义映射后的路径），避免安装包被误识别为应用
    if let Some(ref downloads_lower) = *DOWNLOADS_DIR_LOWER {
        if lower == *downloads_lower {
            return true;
        }
        // 仅当路径是下载目录的子路径时才拒绝（要求路径分隔符紧随其后）
        if let Some(rest) = lower.strip_prefix(downloads_lower.as_str()) {
            if rest.starts_with('\\') {
                return true;
            }
        }
    }
    // Windows.old 等衍生命名
    lower.ends_with("\\windows.old")
}

/// 递归扫描目录树，识别便携/绿色应用
/// max_depth 限制深度避免全盘遍历；dev 目录（node_modules 等）自动跳过
/// 当目录被确认为应用后，不再向下递归（避免把子目录误判为独立应用）
#[cfg(windows)]
fn scan_directory_recursive(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    existing_paths: &HashSet<String>,
    seen: &mut HashSet<String>,
    out: &mut Vec<InstalledApp>,
) {
    if depth > max_depth {
        return;
    }
    if is_blacklisted_path(dir) {
        return;
    }
    // 跳过开发/构建目录和捆绑运行时，防止深度扫描陷入
    if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
        if is_skippable_dir(name) {
            return;
        }
    }

    // 当前目录像应用 → 记录后终止向下递归
    if let Some(exe_path) = directory_looks_like_app(dir) {
        if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
            if is_structural_or_support_dir(name) {
                // 结构性子目录（bin/lib/tools 等）：优先向上重定向到真正的应用根
                if let Some(app_dir) = resolve_app_root_from_structural(dir, &exe_path) {
                    maybe_push_app(&app_dir, &exe_path, existing_paths, seen, out);
                    return;
                }
                // resolve 失败 → 宽松策略：仍允许当前目录作为应用注册，不丢弃
                orbit_log!(
                    "DEBUG", "scanner",
                    "structural dir '{}' resolve failed, registering as-is (exe={})",
                    name,
                    exe_path.display()
                );
            }
            // 非结构性目录 或 结构性目录 resolve 失败 → 直接注册
            maybe_push_app(dir, &exe_path, existing_paths, seen, out);
            return;
        } else {
            maybe_push_app(dir, &exe_path, existing_paths, seen, out);
            return;
        }
    }

    // 递归进入子目录
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_dir() {
            continue;
        }
        // 跳过符号链接/交接点（Windows junction），避免循环和重复扫描
        if ft.is_symlink() {
            continue;
        }
        scan_directory_recursive(
            &entry.path(),
            depth + 1,
            max_depth,
            existing_paths,
            seen,
            out,
        );
    }
}

/// 将候选目录作为应用加入结果集（含去重与基础信息填充）
#[cfg(windows)]
fn maybe_push_app(
    dir: &Path,
    exe_path: &Path,
    existing_paths: &HashSet<String>,
    seen: &mut HashSet<String>,
    out: &mut Vec<InstalledApp>,
) {
    let install_location = dir.to_string_lossy().to_string();
    let key = normalize_path(&install_location);
    if key.is_empty() || existing_paths.contains(&key) || seen.contains(&key) {
        return;
    }

    // display_name 优先使用 exe 的文件名（无扩展名），其次用目录名
    // 目录名"bin"、"lib"等是无意义的，exe stem 才是应用的真实标识
    let display_name = exe_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            dir.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string()
        });

    // 最终安全检查：display_name 不能是结构性无意义的名称
    if display_name.is_empty() || is_never_app_dir(&display_name.to_lowercase()) {
        return;
    }

    seen.insert(key);

    out.push(InstalledApp {
        display_name,
        install_location,
        display_icon: exe_path.to_string_lossy().to_string(),
        estimated_size: 0, // 文件系统扫描不立即计算体积，避免阻塞
        icon_base64: String::new(),
        registry_path: String::new(), // 便携应用无注册表条目
        publisher: String::new(),
    });
}

/// 去重：以 install_location 为主键，移除路径更深（是其他条目子目录）的重复结果
/// 不依赖 display_name —— 同一应用可能因 exe 位置不同被识别为不同名称（如 bin 层）
/// 规则：若 path_j 是 path_i 的子目录 → 保留 path_i（更上层），删除 path_j
/// 这同时消除了"应用在子目录中有重复条目"和"bin 被重定向后与父目录重复"的问题
#[cfg(windows)]
fn dedup_subdirectory_apps(apps: &mut Vec<InstalledApp>) {
    let paths: Vec<String> = apps
        .iter()
        .map(|a| normalize_path(&a.install_location))
        .collect();

    let mut remove_indices: Vec<usize> = Vec::new();
    for i in 0..apps.len() {
        for j in 0..apps.len() {
            if i == j {
                continue;
            }
            // path_j 是 path_i 的子目录：以 path_i + '\\' 为前缀
            if paths[j].starts_with(&paths[i])
                && paths[j].as_bytes().get(paths[i].len()) == Some(&b'\\')
            {
                remove_indices.push(j);
            }
        }
    }

    if remove_indices.is_empty() {
        return;
    }
    remove_indices.sort_unstable();
    remove_indices.dedup();
    // 从后往前删除，保持索引有效
    for idx in remove_indices.into_iter().rev() {
        apps.remove(idx);
    }
}

/// 汇总所有需要扫描的文件系统根目录
#[cfg(windows)]
fn collect_filesystem_roots() -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut shallow_roots: Vec<PathBuf> = Vec::new();
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        shallow_roots.push(PathBuf::from(pf));
    }
    if let Some(pf86) = std::env::var_os("ProgramFiles(x86)") {
        shallow_roots.push(PathBuf::from(pf86));
    }
    if let Some(la) = std::env::var_os("LocalAppData") {
        let local_app_data = PathBuf::from(la);
        // Squirrel 安装器（Electron 应用常用）将应用安装到 %LOCALAPPDATA%\<appname>
        // 例如 MarkText → C:\Users\<user>\AppData\Local\marktext
        shallow_roots.push(local_app_data.clone());
        // Windows Store / ClickOnce 应用可能安装在 Programs 子目录下
        let programs = local_app_data.join("Programs");
        if programs.exists() {
            shallow_roots.push(programs);
        }
    }

    // 非系统固定盘（通过 sysinfo 获取），以及 C 盘常见便携根（只走二级扫描）
    let mut deep_roots: Vec<PathBuf> = Vec::new();
    let disks = sysinfo::Disks::new_with_refreshed_list();
    for disk in &disks {
        let mount = disk.mount_point();
        let mount_str = mount.to_string_lossy().to_uppercase();
        // 跳过系统盘，避免扫描 C:\ 顶层过多系统目录
        if mount_str.starts_with("C:") {
            continue;
        }
        deep_roots.push(mount.to_path_buf());
    }

    (shallow_roots, deep_roots)
}

/// 获取已安装应用列表
/// 扫描 Windows 注册表中的 Uninstall 键，并补充文件系统中的便携/绿色应用
/// 结果会被缓存 `REGISTRY_CACHE_TTL_SECS` 秒，避免频繁刷新重复扫描注册表
pub fn get_installed_apps() -> Result<Vec<InstalledApp>, String> {
    #[cfg(windows)]
    {
        // 命中缓存则直接返回（含图标）
        if let Ok(cache) = REGISTRY_CACHE.lock() {
            if let Some((timestamp, cached)) = cache.as_ref() {
                if timestamp.elapsed().as_secs() < REGISTRY_CACHE_TTL_SECS {
                    return Ok(cached.clone());
                }
            }
        }

        let mut apps: Vec<InstalledApp> = Vec::new();

        // 定义需要扫描的注册表路径
        // 包括 64 位和 32 位应用的注册表位置
        // 扫描全部 4 个注册表 Uninstall 路径，覆盖 64 位/32 位 + 机器级/用户级
        let registry_paths: [(HKEY, &str, &str); 4] = [
            (
                HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                "HKLM",
            ),
            (
                HKEY_LOCAL_MACHINE,
                r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
                "HKLM",
            ),
            (
                HKEY_CURRENT_USER,
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                "HKCU",
            ),
            (
                HKEY_CURRENT_USER,
                r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
                "HKCU",
            ),
        ];

        for (hkey, base_path, hive_name) in registry_paths {
            if let Ok(uninstall_key) = RegKey::predef(hkey).open_subkey(base_path) {
                for subkey_name in uninstall_key.enum_keys().filter_map(|k| k.ok()) {
                    if let Ok(subkey) = uninstall_key.open_subkey(&subkey_name) {
                        // 读取应用显示名称，跳过没有名称的条目
                        let display_name: String = subkey.get_value("DisplayName").unwrap_or_default();
                        if display_name.is_empty() {
                            continue;
                        }

                        // 读取安装位置
                        let raw_location: String = subkey.get_value("InstallLocation").unwrap_or_default();
                        let mut install_location = raw_location.trim().trim_matches('"').to_string();

                        // 读取应用图标路径
                        let display_icon: String = subkey.get_value("DisplayIcon").unwrap_or_default();

                        // 读取发布商（用于强力卸载残留匹配）
                        let publisher: String = subkey.get_value("Publisher").unwrap_or_default();

                        // 读取预估大小（KB）
                        let estimated_size: u64 = subkey.get_value::<u32, _>("EstimatedSize").unwrap_or(0) as u64;

                        // 回退推导：当 InstallLocation 缺失时，尝试从 DisplayIcon / UninstallString 推导
                        if install_location.is_empty() {
                            if let Some(dir) = derive_install_location_from_icon(&display_icon) {
                                install_location = dir;
                            } else {
                                let uninstall_string: String =
                                    subkey.get_value("UninstallString").unwrap_or_default();
                                if let Some(dir) = derive_install_location_from_icon(&uninstall_string) {
                                    install_location = dir;
                                }
                            }
                        }

                        // 仅保留可迁移应用
                        if install_location.is_empty() {
                            continue;
                        }

                        // 幽灵条目过滤 1：注册表残留的路径实际已被手动删除
                        if !Path::new(&install_location).exists() {
                            continue;
                        }

                        // 幽灵条目过滤 2：DisplayIcon 指向的 exe 已不存在
                        // 卸载器执行后主程序已被删除，但注册表键残留（Squirrel/Electron 应用常见）
                        if !display_icon.is_empty() {
                            let icon_file = display_icon
                                .split(',')
                                .next()
                                .unwrap_or(&display_icon)
                                .trim()
                                .trim_matches('"');
                            if !icon_file.is_empty() && !Path::new(icon_file).exists() {
                                continue;
                            }
                        }

                        // 生成唯一注册表路径，供卸载功能复用
                        let app_registry_path = format!("{}\\{}\\{}", hive_name, base_path, subkey_name);

                        // 按"名称+路径"去重，避免仅按名称导致误去重
                        let duplicated = apps.iter().any(|app| {
                            app.display_name == display_name && app.install_location == install_location
                        });
                        if duplicated {
                            continue;
                        }

                        apps.push(InstalledApp {
                            display_name,
                            install_location,
                            display_icon,
                            estimated_size,
                            icon_base64: String::new(),
                            registry_path: app_registry_path,
                            publisher,
                        });
                    }
                }
            }
        }

        // 文件系统扫描：补齐注册表未覆盖的便携/绿色应用
        let mut existing_paths: HashSet<String> = apps
            .iter()
            .map(|a| normalize_path(&a.install_location))
            .collect();
        let mut seen: HashSet<String> = HashSet::new();
        let (shallow_roots, deep_roots) = collect_filesystem_roots();
        // C 盘已知安装目录: 浅扫（max_depth=1，即根 + 一层子目录）
        for root in &shallow_roots {
            scan_directory_recursive(root, 0, 1, &existing_paths, &mut seen, &mut apps);
        }
        // 跨 root 去重：防止 D 盘、E 盘扫描到相同路径
        existing_paths.extend(seen.iter().cloned());
        // 非 C 盘根目录：深扫（max_depth=3），覆盖 E:\app\other\Snipaste-x64 等深层便携应用
        for root in &deep_roots {
            scan_directory_recursive(root, 0, 3, &existing_paths, &mut seen, &mut apps);
        }

        // 去重：同名应用中移除子目录里的重复条目
        // 例如 android_studio (D:\software\android_studio\) 和同名的 (D:\software\android_studio\bin\)
        // → 保留路径较短的记录
        dedup_subdirectory_apps(&mut apps);

        // 按应用名称排序
        apps.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));

        // 提取图标 + 计算目录大小（并行：避免阻塞主线程）
        if !apps.is_empty() {
            let num_threads = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4);
            let chunk_size = ((apps.len() + num_threads - 1) / num_threads).max(1);
            std::thread::scope(|s| {
                for chunk in apps.chunks_mut(chunk_size) {
                    s.spawn(move || {
                        for app in chunk {
                            if !app.display_icon.is_empty() {
                                app.icon_base64 =
                                    crate::system::icon::extract_icon_to_base64(&app.display_icon);
                            }
                            // 注册表 EstimatedSize 大多为空（显示"未知"），
                            // 在此并行计算安装目录的实际体积
                            if app.estimated_size == 0 && !app.install_location.is_empty() {
                                let dir = Path::new(&app.install_location);
                                if dir.exists() {
                                    app.estimated_size = compute_dir_size_kb(dir);
                                }
                            }
                        }
                    });
                }
            });
        }

        // 写入缓存
        if let Ok(mut cache) = REGISTRY_CACHE.lock() {
            *cache = Some((Instant::now(), apps.clone()));
        }

        Ok(apps)
    }

    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

/// 计算目录下所有文件的总大小，返回 KB
#[cfg(windows)]
fn compute_dir_size_kb(dir: &Path) -> u64 {
    WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|entry| entry.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum::<u64>()
        / 1024
}

/// 检测指定路径是否被进程占用
/// 使用 sysinfo 扫描进程可执行路径，快速判断潜在占用
pub fn check_process_locks(source_path: String) -> Result<ProcessLockResult, String> {
    let source = Path::new(&source_path);

    if !source.exists() {
        return Err(format!("源路径不存在: {}", source_path));
    }

    let mut sys = System::new_all();
    sys.refresh_all();

    let mut locked_processes: Vec<String> = Vec::new();
    let source_lower = source_path.to_lowercase();

    for (_, process) in sys.processes() {
        if let Some(exe_path) = process.exe() {
            let exe_str = exe_path.to_string_lossy().to_lowercase();
            if exe_str.starts_with(&source_lower) {
                let name = process.name().to_string_lossy().to_string();
                if !locked_processes.contains(&name) {
                    locked_processes.push(name);
                }
            }
        }
    }

    Ok(ProcessLockResult {
        is_locked: !locked_processes.is_empty(),
        processes: locked_processes,
    })
}
