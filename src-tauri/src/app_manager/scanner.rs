// 应用扫描模块
// 负责扫描已安装应用与进程占用检测
//
// 设计说明（中文）：
// 1. 注册表扫描（原实现保留）：遍历 HKLM/HKCU 下的 Uninstall 键获取结构化信息
// 2. DisplayIcon 回退：当 InstallLocation 缺失时，尝试从 DisplayIcon / UninstallString 推导安装目录，
//    覆盖 ComfyUI、部分便携安装器等只写入图标路径的场景
// 3. 文件系统扫描（增强）：扫描 Program Files、Program Files (x86)、LocalAppData\Programs 以及
//    所有非系统盘的顶层与二级目录，识别“目录内含 exe / bat / cmd”的便携/绿色应用
//    按规范化路径严格去重，不覆盖已由注册表获得的条目

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::{InstalledApp, ProcessLockResult};
use sysinfo::System;

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

    // 1) 提取首个路径片段（去掉引号与参数）
    let stripped = raw.trim_matches('"');
    // 去掉 ",索引" 后缀
    let (before_comma, _) = stripped.split_once(',').unwrap_or((stripped, ""));
    // 若带参数："C:\path\foo.exe" /S -> 取引号内；否则取空格前部分
    let candidate = if before_comma.starts_with('"') {
        before_comma.trim_matches('"')
    } else {
        before_comma.split_whitespace().next().unwrap_or(before_comma)
    };

    let p = Path::new(candidate);
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

/// 判断文件名是否看起来像安装包/卸载器而非主程序
/// 规则（全小写匹配）：
/// - 显性字样：setup / install / uninstall / unins
/// - 版本化架构后缀：_x64.exe / _x86.exe / _win64.exe / _win32.exe
/// - 纯版本号命名：sunloginclient_11.1.1.38222_x64.exe 等
#[cfg(windows)]
fn is_installer_like_exe(file_name_lower: &str) -> bool {
    if file_name_lower.contains("setup")
        || file_name_lower.contains("install") // 同时覆盖 installer
        || file_name_lower.contains("unins")
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

/// 判断目录是否“看起来像一个应用目录”
/// 规则：
/// - 目录下包含至少一个非安装包性质的 exe，或 bat/cmd 启动脚本
/// - 仅包含安装包并且名称与目录不匹配的目录被识别为“残留安装文件夹”，不返回
///   例如向日葵残留：目录 向日葵/下只有 SunloginClient_11.x_x64.exe 与 isntall 子目录
#[cfg(windows)]
fn directory_looks_like_app(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut main_exe: Option<PathBuf> = None;
    let mut fallback_launcher: Option<PathBuf> = None;
    let mut has_dll = false;
    let mut installer_exe: Option<PathBuf> = None;
    let dir_name_lower = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name_lower = path
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_l = ext.to_lowercase();
            match ext_l.as_str() {
                "exe" => {
                    let stem = path
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_lowercase())
                        .unwrap_or_default();
                    // 优先命中与目录同名的 exe，作为主程序
                    if stem == dir_name_lower || dir_name_lower.contains(&stem) {
                        return Some(path);
                    }
                    // 识别安装包、卸载器、版本化安装文件
                    if is_installer_like_exe(&file_name_lower) {
                        if installer_exe.is_none() {
                            installer_exe = Some(path);
                        }
                        continue;
                    }
                    if main_exe.is_none() {
                        main_exe = Some(path);
                    }
                }
                "dll" => {
                    has_dll = true;
                }
                "bat" | "cmd" => {
                    if fallback_launcher.is_none() {
                        fallback_launcher = Some(path);
                    }
                }
                "msi" => {
                    // MSI 包不算主程序
                    if installer_exe.is_none() {
                        installer_exe = Some(path);
                    }
                }
                _ => {}
            }
        }
    }

    // 正常主程序优先
    if let Some(p) = main_exe {
        return Some(p);
    }
    // 仅 bat/cmd 脚本的便携包（如 ComfyUI）——需配合 dll 或没有安装包特征才视为应用
    if let Some(p) = fallback_launcher {
        if has_dll || installer_exe.is_none() {
            return Some(p);
        }
    }
    // 只有安装包 exe 而没有伴随 dll——视为残留安装包，拒绝识别
    if installer_exe.is_some() && !has_dll {
        return None;
    }
    installer_exe
}

/// 路径是否属于应当跳过的系统/空目录
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
    // Windows.old 等衍生命名
    lower.ends_with("\\windows.old")
}

/// 扫描候选目录列表，追加识别出的便携/绿色应用
#[cfg(windows)]
fn scan_filesystem_candidates(
    roots: &[PathBuf],
    deep_scan: bool,
    existing_paths: &HashSet<String>,
    out: &mut Vec<InstalledApp>,
    seen: &mut HashSet<String>,
) {
    for root in roots {
        if !root.exists() {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(root) else { continue };
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            if !ft.is_dir() {
                continue;
            }
            let dir = entry.path();
            if is_blacklisted_path(&dir) {
                continue;
            }

            // 第一层：目录本身是否像应用
            if let Some(exe_path) = directory_looks_like_app(&dir) {
                maybe_push_app(&dir, &exe_path, existing_paths, seen, out);
                continue;
            }

            // 第二层（仅 deep_scan）：例如 D:\software\appname
            if deep_scan {
                let Ok(sub_entries) = std::fs::read_dir(&dir) else { continue };
                for sub in sub_entries.flatten() {
                    let Ok(sft) = sub.file_type() else { continue };
                    if !sft.is_dir() {
                        continue;
                    }
                    let sub_dir = sub.path();
                    if is_blacklisted_path(&sub_dir) {
                        continue;
                    }
                    if let Some(exe_path) = directory_looks_like_app(&sub_dir) {
                        maybe_push_app(&sub_dir, &exe_path, existing_paths, seen, out);
                    }
                }
            }
        }
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
    seen.insert(key);

    let display_name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| install_location.clone());

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
        let programs = PathBuf::from(la).join("Programs");
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
pub fn get_installed_apps() -> Result<Vec<InstalledApp>, String> {
    #[cfg(windows)]
    {
        let mut apps: Vec<InstalledApp> = Vec::new();

        // 定义需要扫描的注册表路径
        // 包括 64 位和 32 位应用的注册表位置
        let registry_paths: [(HKEY, &str, &str); 3] = [
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

                        // 幽灵条目过滤：注册表残留的路径实际已被手动删除（如 Adobe Premiere Pro 2020）
                        // 直接验证目录存在性，避免上报不可迁移的旧条目
                        if !Path::new(&install_location).exists() {
                            continue;
                        }

                        // 生成唯一注册表路径，供卸载功能复用
                        let app_registry_path = format!("{}\\{}\\{}", hive_name, base_path, subkey_name);

                        // 按“名称+路径”去重，避免仅按名称导致误去重
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
        scan_filesystem_candidates(&shallow_roots, false, &existing_paths, &mut apps, &mut seen);
        // 更新 existing_paths 以避免深扫时重复添加第一层结果
        existing_paths.extend(seen.iter().cloned());
        scan_filesystem_candidates(&deep_roots, true, &existing_paths, &mut apps, &mut seen);

        // 按应用名称排序
        apps.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));

        // 提取图标（带缓存）
        for app in &mut apps {
            if !app.display_icon.is_empty() {
                app.icon_base64 = crate::extract_icon_to_base64(&app.display_icon);
            }
        }

        Ok(apps)
    }

    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
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
