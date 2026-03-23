// 应用扫描模块
// 负责扫描已安装应用与进程占用检测

use std::path::Path;

use crate::{InstalledApp, ProcessLockResult};
use sysinfo::System;

#[cfg(windows)]
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
#[cfg(windows)]
use winreg::RegKey;
#[cfg(windows)]
use winreg::HKEY;

/// 获取已安装应用列表
/// 扫描 Windows 注册表中的 Uninstall 键，提取应用信息
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
                        let install_location = raw_location.trim().trim_matches('"').to_string();

                        // 读取应用图标路径
                        let display_icon: String = subkey.get_value("DisplayIcon").unwrap_or_default();

                        // 读取预估大小（KB）
                        let estimated_size: u64 = subkey.get_value::<u32, _>("EstimatedSize").unwrap_or(0) as u64;

                        // 仅保留可迁移应用
                        if install_location.is_empty() {
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
                        });
                    }
                }
            }
        }

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
