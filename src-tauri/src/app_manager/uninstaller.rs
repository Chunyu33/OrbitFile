// 应用卸载模块
// 负责从注册表读取卸载命令并启动卸载进程

use serde::{Deserialize, Serialize};

#[cfg(windows)]
use std::process::Command;
#[cfg(windows)]
use std::thread;
#[cfg(windows)]
use std::time::Duration;
#[cfg(windows)]
use std::path::Path;
#[cfg(windows)]
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
#[cfg(windows)]
use winreg::RegKey;
#[cfg(windows)]
use winreg::HKEY;

/// 卸载请求参数
/// 支持按 app_id（通常传显示名）或 registry_path 定位应用
#[derive(Debug, Deserialize)]
pub struct UninstallInput {
    pub app_id: Option<String>,
    pub registry_path: Option<String>,
}

/// 卸载命令返回结果
#[derive(Debug, Serialize)]
pub struct UninstallResult {
    pub success: bool,
    pub message: String,
    pub command: Option<String>,
}

/// 启动应用卸载程序
/// 优先读取 QuietUninstallString，若为空再读取 UninstallString
pub fn uninstall_application(input: UninstallInput) -> Result<UninstallResult, String> {
    #[cfg(windows)]
    {
        let uninstall_cmd = resolve_uninstall_command(&input)?;
        start_uninstall_process(&uninstall_cmd)?;

        Ok(UninstallResult {
            success: true,
            message: "已成功启动卸载程序，请按卸载向导完成后续操作。".to_string(),
            command: Some(uninstall_cmd),
        })
    }

    #[cfg(not(windows))]
    {
        let _ = input;
        Ok(UninstallResult {
            success: false,
            message: "卸载功能仅支持 Windows 系统".to_string(),
            command: None,
        })
    }
}

#[cfg(windows)]
fn resolve_uninstall_command(input: &UninstallInput) -> Result<String, String> {
    // 路径优先：如果前端传了 registry_path，直接按路径定位
    if let Some(registry_path) = input.registry_path.as_ref() {
        if let Some(cmd) = read_uninstall_from_registry_path(registry_path) {
            return Ok(cmd);
        }
        return Err(format!("未在指定注册表路径找到可用卸载命令: {}", registry_path));
    }

    // 其次按 app_id（这里按 DisplayName 匹配）回查注册表
    if let Some(app_id) = input.app_id.as_ref() {
        if let Some(cmd) = find_uninstall_by_display_name(app_id) {
            return Ok(cmd);
        }
        return Err(format!("未找到应用 '{}' 的卸载命令", app_id));
    }

    Err("参数无效：请提供 app_id 或 registry_path".to_string())
}

#[cfg(windows)]
fn start_uninstall_process(uninstall_cmd: &str) -> Result<(), String> {
    let cmd = uninstall_cmd.trim();
    if cmd.is_empty() {
        return Err("卸载命令为空".to_string());
    }

    // 方案 A：优先按“可执行文件 + 参数”直接启动，避免 cmd 对特殊字符误解释
    if let Some((program, args)) = parse_program_and_args(cmd) {
        if is_definitely_invalid_program(&program) {
            return Err(format!("卸载命令无效，程序路径非法: {}", program));
        }

        // 对绝对路径 exe 做存在性预检查，避免弹系统“找不到文件”对话框
        let is_path_like = program.contains('\\') || program.contains(':');
        if is_path_like && !program.eq_ignore_ascii_case("msiexec") && !program.eq_ignore_ascii_case("msiexec.exe") {
            if !Path::new(&program).exists() {
                return Err(format!("卸载程序不存在: {}", program));
            }
        }

        if spawn_and_validate(&program, &args).is_ok() {
            return Ok(());
        }
    }

    // 方案 B：直接交给 cmd /C 执行（兼容复杂 shell 命令）
    let mut direct_child = Command::new("cmd")
        .args(["/C", cmd])
        .spawn()
        .map_err(|e| format!("启动卸载程序失败: {}", e))?;

    // 等待极短时间用于识别“命令立刻报错退出”的场景
    // 例如：引号格式不兼容、命令解释失败等
    thread::sleep(Duration::from_millis(250));
    if let Ok(Some(status)) = direct_child.try_wait() {
        if !status.success() {
            // 方案 C：回退到 start 方式，兼容更多带引号/参数的命令格式
            let start_cmd = format!("start \"\" {}", cmd);
            let mut fallback_child = Command::new("cmd")
                .args(["/C", &start_cmd])
                .spawn()
                .map_err(|e| format!("卸载命令执行失败，回退启动也失败: {}", e))?;

            thread::sleep(Duration::from_millis(250));
            if let Ok(Some(fallback_status)) = fallback_child.try_wait() {
                if !fallback_status.success() {
                    return Err(format!(
                        "卸载程序未能启动，退出码: {}",
                        fallback_status.code().unwrap_or(-1)
                    ));
                }
            }
        }
    }

    Ok(())
}

#[cfg(windows)]
fn parse_program_and_args(command: &str) -> Option<(String, Vec<String>)> {
    let cmd = command.trim();
    if cmd.is_empty() {
        return None;
    }

    // 处理带引号的可执行文件路径
    if let Some(rest) = cmd.strip_prefix('"') {
        let end = rest.find('"')?;
        let program = rest[..end].trim().to_string();
        let args_raw = rest[end + 1..].trim();
        return Some((program, split_command_args(args_raw)));
    }

    // 处理不带引号的命令：第一个空白前视为程序名
    let mut parts = cmd.splitn(2, char::is_whitespace);
    let program = parts.next()?.trim().to_string();
    let args_raw = parts.next().unwrap_or("").trim();
    Some((program, split_command_args(args_raw)))
}

#[cfg(windows)]
fn split_command_args(input: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in input.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
            }
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    args.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }

    if !current.is_empty() {
        args.push(current);
    }

    args
}

#[cfg(windows)]
fn spawn_and_validate(program: &str, args: &[String]) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(args)
        .spawn()
        .map_err(|e| format!("启动卸载程序失败: {}", e))?;

    thread::sleep(Duration::from_millis(250));
    if let Ok(Some(status)) = child.try_wait() {
        if !status.success() {
            return Err(format!("卸载程序启动后立即退出，退出码: {}", status.code().unwrap_or(-1)));
        }
    }

    Ok(())
}

#[cfg(windows)]
fn is_definitely_invalid_program(program: &str) -> bool {
    let p = program.trim().trim_matches('"').trim();
    p.is_empty() || p == "\\" || p == "\\\\" || p == "/"
}

#[cfg(windows)]
fn read_uninstall_from_registry_path(path: &str) -> Option<String> {
    let (hkey, sub_path) = parse_registry_path(path)?;
    let key = RegKey::predef(hkey).open_subkey(sub_path).ok()?;

    // QuietUninstallString 优先
    let quiet: String = key.get_value("QuietUninstallString").unwrap_or_default();
    if is_valid_uninstall_command(&quiet) {
        return Some(quiet.trim().to_string());
    }

    let normal: String = key.get_value("UninstallString").unwrap_or_default();
    if is_valid_uninstall_command(&normal) {
        return Some(normal.trim().to_string());
    }

    None
}

#[cfg(windows)]
fn find_uninstall_by_display_name(app_id: &str) -> Option<String> {
    let query = app_id.trim().to_lowercase();
    if query.is_empty() {
        return None;
    }

    let registry_roots: [(HKEY, &str); 3] = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];

    for (hkey, path) in registry_roots {
        let uninstall_key = match RegKey::predef(hkey).open_subkey(path) {
            Ok(k) => k,
            Err(_) => continue,
        };

        for subkey_name in uninstall_key.enum_keys().filter_map(|x| x.ok()) {
            let subkey = match uninstall_key.open_subkey(&subkey_name) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let display_name: String = subkey.get_value("DisplayName").unwrap_or_default();
            if display_name.trim().to_lowercase() != query {
                continue;
            }

            let quiet: String = subkey.get_value("QuietUninstallString").unwrap_or_default();
            if is_valid_uninstall_command(&quiet) {
                return Some(quiet.trim().to_string());
            }

            let normal: String = subkey.get_value("UninstallString").unwrap_or_default();
            if is_valid_uninstall_command(&normal) {
                return Some(normal.trim().to_string());
            }
        }
    }

    None
}

#[cfg(windows)]
fn parse_registry_path(path: &str) -> Option<(HKEY, &str)> {
    if let Some(rest) = path.strip_prefix("HKLM\\") {
        return Some((HKEY_LOCAL_MACHINE, rest));
    }
    if let Some(rest) = path.strip_prefix("HKEY_LOCAL_MACHINE\\") {
        return Some((HKEY_LOCAL_MACHINE, rest));
    }
    if let Some(rest) = path.strip_prefix("HKCU\\") {
        return Some((HKEY_CURRENT_USER, rest));
    }
    if let Some(rest) = path.strip_prefix("HKEY_CURRENT_USER\\") {
        return Some((HKEY_CURRENT_USER, rest));
    }
    None
}

#[cfg(windows)]
fn is_valid_uninstall_command(command: &str) -> bool {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return false;
    }

    // 一些注册表项会写入无效占位值，典型表现是仅有反斜杠
    let normalized = trimmed.trim_matches('"').trim();
    if normalized.is_empty() {
        return false;
    }

    normalized != "\\" && normalized != "\\\\" && normalized != "/"
}
