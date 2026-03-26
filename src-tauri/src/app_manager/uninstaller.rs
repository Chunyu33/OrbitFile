// 应用卸载模块
// 负责执行卸载流程、扫描残留项、执行清理

use serde::{Deserialize, Serialize};

#[cfg(windows)]
use std::collections::HashSet;
#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::Command;
#[cfg(windows)]
use std::thread;
#[cfg(windows)]
use std::time::Duration;
#[cfg(windows)]
use walkdir::WalkDir;
#[cfg(windows)]
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
#[cfg(windows)]
use winreg::{HKEY, RegKey};

#[cfg(windows)]
const BLACKLIST: &[&str] = &["microsoft", "windows", "common files", "tauri", "webview2"];

/// 卸载请求参数
/// 支持按 app_id（通常传显示名）或 registry_path 定位应用
#[derive(Debug, Deserialize)]
pub struct UninstallInput {
    pub app_id: Option<String>,
    pub registry_path: Option<String>,
}

#[cfg(windows)]
fn sanitize_search_text(raw: &str) -> String {
    raw.chars()
        .filter(|ch| !ch.is_control())
        .collect::<String>()
        .trim()
        .trim_matches('"')
        .to_string()
}

#[cfg(windows)]
#[derive(Debug, Clone)]
struct StrictScanContext {
    app_name_exact: String,
    app_folder_name: String,
    publisher_name: Option<String>,
    install_location: Option<String>,
    uninstall_path_hints: Vec<String>,
}

#[cfg(windows)]
fn normalize_match_text(raw: &str) -> String {
    sanitize_search_text(raw).to_lowercase()
}

#[cfg(windows)]
fn normalize_windows_path(raw: &str) -> String {
    normalize_match_text(raw).replace('/', r"\")
}

#[cfg(windows)]
fn extract_last_path_component(path: &str) -> Option<String> {
    let normalized = normalize_windows_path(path);
    if normalized.is_empty() {
        return None;
    }

    Path::new(&normalized)
        .file_name()
        .map(|v| normalize_match_text(&v.to_string_lossy()))
        .filter(|v| !v.is_empty())
}

#[cfg(windows)]
fn build_strict_scan_context(
    app_name: &str,
    publisher: Option<&str>,
    install_location: Option<&str>,
) -> Option<StrictScanContext> {
    let app_name_exact = normalize_match_text(app_name);
    if app_name_exact.is_empty() {
        return None;
    }

    let install_location = install_location
        .map(normalize_windows_path)
        .filter(|v| !v.is_empty());

    let app_folder_name = install_location
        .as_deref()
        .and_then(extract_last_path_component)
        .or_else(|| {
            app_name_exact
                .split(|c: char| matches!(c, '\\' | '/' | ':' | '"' | '*' | '?' | '<' | '>' | '|'))
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .max_by_key(|v| v.len())
                .map(|v| v.to_string())
        })?;

    let publisher_name = publisher
        .map(normalize_match_text)
        .filter(|v| !v.is_empty());

    let uninstall_path_hints = collect_uninstall_path_hints(&app_name_exact, install_location.as_deref());

    Some(StrictScanContext {
        app_name_exact,
        app_folder_name,
        publisher_name,
        install_location,
        uninstall_path_hints,
    })
}

#[cfg(windows)]
fn matches_keywords(text: &str, keywords: &[String]) -> bool {
    keywords.iter().any(|kw| keyword_matches(text, kw))
}

#[cfg(windows)]
fn keyword_matches(text: &str, keyword: &str) -> bool {
    if keyword.is_empty() {
        return false;
    }

    if keyword.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return contains_ascii_keyword_with_boundary(text, keyword);
    }

    text.contains(keyword)
}

#[cfg(windows)]
fn contains_ascii_keyword_with_boundary(text: &str, keyword: &str) -> bool {
    for (start, _) in text.match_indices(keyword) {
        let end = start + keyword.len();

        let before_is_word = if start == 0 {
            false
        } else {
            text[..start]
                .chars()
                .last()
                .map(|c| c.is_ascii_alphanumeric())
                .unwrap_or(false)
        };

        let after_is_word = if end >= text.len() {
            false
        } else {
            text[end..]
                .chars()
                .next()
                .map(|c| c.is_ascii_alphanumeric())
                .unwrap_or(false)
        };

        if !before_is_word && !after_is_word {
            return true;
        }
    }

    false
}

#[cfg(windows)]
fn is_safe_registry_cleanup_target(hkey: HKEY, sub_path: &str, keywords: &[String]) -> bool {
    let normalized = sub_path.trim().trim_matches('\\').to_lowercase();
    if normalized.is_empty() || normalized == "software" {
        return false;
    }

    if is_blacklisted_registry_path(hkey, &normalized) {
        return false;
    }

    // 仅允许清理 Software 子树，避免触碰系统关键分支
    if !normalized.starts_with("software\\") {
        return false;
    }

    // 顶层供应商目录风险高（如 Software\Microsoft），至少要求二级路径
    if normalized.split('\\').count() < 3 {
        return false;
    }

    let key = match RegKey::predef(hkey).open_subkey_with_flags(sub_path, KEY_READ) {
        Ok(v) => v,
        Err(_) => return false,
    };

    // 空键可安全删除（常见于卸载后残留空壳）
    if is_registry_key_empty(&key) {
        return true;
    }

    if keywords.is_empty() {
        return false;
    }

    registry_key_belongs_to_app(&key, &normalized, keywords)
}

#[cfg(windows)]
fn is_registry_key_empty(key: &RegKey) -> bool {
    key.enum_keys().next().is_none() && key.enum_values().next().is_none()
}

#[cfg(windows)]
fn registry_key_belongs_to_app(key: &RegKey, sub_path: &str, keywords: &[String]) -> bool {
    if matches_keywords(sub_path, keywords) {
        return true;
    }

    let display_name: String = key.get_value("DisplayName").unwrap_or_default();
    let publisher: String = key.get_value("Publisher").unwrap_or_default();
    let install_location: String = key.get_value("InstallLocation").unwrap_or_default();
    let uninstall_string: String = key.get_value("UninstallString").unwrap_or_default();

    [display_name, publisher, install_location, uninstall_string]
        .into_iter()
        .map(|v| sanitize_search_text(&v).to_lowercase())
        .any(|v| !v.is_empty() && matches_keywords(&v, keywords))
}

#[cfg(windows)]
fn expand_uninstall_command_candidates(commands: Vec<String>) -> Vec<String> {
    let mut expanded: Vec<String> = Vec::new();

    for command in commands {
        let cmd = command.trim().to_string();
        if cmd.is_empty() {
            continue;
        }

        push_unique_command(&mut expanded, cmd.clone());

        if let Some((program, args)) = parse_program_and_args(&cmd) {
            if !args.is_empty() {
                continue;
            }

            let file_name = Path::new(&program)
                .file_name()
                .map(|v| v.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            if file_name.contains("uninst") || file_name.contains("uninstall") {
                let quoted_program = quote_program(&program);
                for flag in ["/S", "/silent", "/verysilent", "/qn", "/quiet"] {
                    push_unique_command(&mut expanded, format!("{} {}", quoted_program, flag));
                }
            }
        }
    }

    expanded
}

#[cfg(windows)]
fn push_unique_command(target: &mut Vec<String>, command: String) {
    if !target.iter().any(|v| v.eq_ignore_ascii_case(&command)) {
        target.push(command);
    }
}

#[cfg(windows)]
fn quote_program(program: &str) -> String {
    let trimmed = program.trim();
    if trimmed.starts_with('"') && trimmed.ends_with('"') {
        return trimmed.to_string();
    }

    if trimmed.contains(' ') {
        format!("\"{}\"", trimmed)
    } else {
        trimmed.to_string()
    }
}

#[cfg(windows)]
fn wait_until_uninstalled(input: &UninstallInput) -> bool {
    // 给注册表和安装器足够时间完成状态落盘
    // 一些卸载器会先拉起 GUI 子进程再退出，整体耗时可能超过几十秒
    for _ in 0..240 {
        if !is_application_still_installed(input) {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

#[cfg(windows)]
fn is_application_still_installed(input: &UninstallInput) -> bool {
    if let Some(registry_path) = input.registry_path.as_ref() {
        if let Some((hkey, sub_path)) = parse_registry_path(registry_path) {
            if RegKey::predef(hkey).open_subkey_with_flags(sub_path, KEY_READ).is_ok() {
                return true;
            }
        }
    }

    if let Some(app_id) = input.app_id.as_ref() {
        if find_uninstall_by_display_name(app_id).is_some() {
            return true;
        }
    }

    false
}

/// 残留项结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LeftoverItem {
    pub path: String,
    pub item_type: String, // Folder | File | Registry
    pub size_mb: f64,
    pub selected: bool,
}

/// 卸载命令返回结果
#[derive(Debug, Serialize, Deserialize)]
pub struct UninstallResult {
    pub success: bool,
    pub message: String,
    pub command: Option<String>,
    pub leftovers: Vec<LeftoverItem>,
}

/// 清理执行结果
#[derive(Debug, Serialize, Deserialize)]
pub struct CleanupResult {
    pub success: bool,
    pub message: String,
    pub cleaned_count: usize,
    pub failed_items: Vec<String>,
}

/// 强力卸载入口
/// 1) 解析并执行卸载命令（等待卸载进程退出）
/// 2) 返回成功后由前端手动确认是否触发残留扫描
pub async fn uninstall_application(input: UninstallInput) -> Result<UninstallResult, String> {
    #[cfg(windows)]
    {
        let uninstall_cmds = resolve_uninstall_commands(&input)?;
        eprintln!("[orbit-file][uninstall] 候选卸载命令数量: {}", uninstall_cmds.len());
        let mut executed_cmd: Option<String> = None;
        let mut command_errors: Vec<String> = Vec::new();

        for uninstall_cmd in uninstall_cmds {
            eprintln!("[orbit-file][uninstall] 尝试执行命令: {}", uninstall_cmd);
            match start_uninstall_process(&uninstall_cmd) {
                Ok(_) => {
                    executed_cmd = Some(uninstall_cmd.clone());
                    if !wait_until_uninstalled(&input) {
                        eprintln!("[orbit-file][uninstall] 命令执行后仍检测到已安装，继续尝试下一条命令");
                        continue;
                    }

                    return Ok(UninstallResult {
                        success: true,
                        message: "卸载流程已完成。请在前端手动确认后再触发残留扫描。".to_string(),
                        command: Some(uninstall_cmd),
                        leftovers: Vec::new(),
                    });
                }
                Err(err) => {
                    command_errors.push(format!("{} => {}", uninstall_cmd, err));
                }
            }
        }

        if let Some(cmd) = executed_cmd {
            return Err(format!(
                "卸载命令已执行但仍检测到应用存在（可能未在卸载向导中确认完成）：{}",
                cmd
            ));
        }

        if !command_errors.is_empty() {
            return Err(format!("卸载命令执行失败：{}", command_errors.join(" | ")));
        }

        Err("未找到可执行的卸载命令".to_string())
    }

    #[cfg(not(windows))]
    {
        let _ = input;
        Ok(UninstallResult {
            success: false,
            message: "卸载功能仅支持 Windows 系统".to_string(),
            command: None,
            leftovers: Vec::new(),
        })
    }
}

/// 独立残留扫描命令
/// 供前端在需要时单独触发扫描
pub fn scan_app_residue(
    app_name: String,
    publisher: Option<String>,
    install_location: Option<String>,
) -> Result<Vec<LeftoverItem>, String> {
    #[cfg(windows)]
    {
        let mut leftovers = scan_app_residue_internal(app_name, publisher, install_location)?;
        leftovers.sort_by(|a, b| b.size_mb.partial_cmp(&a.size_mb).unwrap_or(std::cmp::Ordering::Equal));
        Ok(leftovers)
    }

    #[cfg(not(windows))]
    {
        let _ = (app_name, publisher, install_location);
        Ok(Vec::new())
    }
}

/// 执行清理命令
/// items 支持两类输入：
/// - 文件/目录路径: C:\\xxx\\yyy
/// - 注册表路径: HKCU\\Software\\xxx 或 HKLM\\Software\\xxx
pub fn execute_cleanup(
    items: Vec<String>,
    app_name: Option<String>,
    publisher: Option<String>,
) -> Result<CleanupResult, String> {
    #[cfg(windows)]
    {
        let cleanup_keywords = build_keywords(
            app_name.as_deref().unwrap_or_default(),
            publisher.as_deref(),
            None,
        );

        if items.is_empty() {
            return Ok(CleanupResult {
                success: true,
                message: "没有需要清理的项目".to_string(),
                cleaned_count: 0,
                failed_items: Vec::new(),
            });
        }

        let mut cleaned_count = 0usize;
        let mut failed_items: Vec<String> = Vec::new();

        for item in items {
            if let Some((hkey, sub_path)) = parse_registry_path(&item) {
                if !is_safe_registry_cleanup_target(hkey, sub_path, &cleanup_keywords) {
                    failed_items.push(item);
                    continue;
                }

                let deleted = RegKey::predef(hkey)
                    .delete_subkey_all(sub_path)
                    .is_ok();
                if deleted {
                    cleaned_count += 1;
                } else {
                    failed_items.push(item);
                }
                continue;
            }

            let path = PathBuf::from(item.trim());
            if !path.exists() {
                continue;
            }

            if is_blacklisted_path(&path) {
                failed_items.push(path.to_string_lossy().to_string());
                continue;
            }

            let delete_result = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };

            if delete_result.is_ok() {
                cleaned_count += 1;
            } else {
                failed_items.push(path.to_string_lossy().to_string());
            }
        }

        let success = failed_items.is_empty();
        let message = if success {
            format!("清理完成，共删除 {} 项", cleaned_count)
        } else {
            format!(
                "清理已完成，成功 {} 项，失败 {} 项",
                cleaned_count,
                failed_items.len()
            )
        };

        Ok(CleanupResult {
            success,
            message,
            cleaned_count,
            failed_items,
        })
    }

    #[cfg(not(windows))]
    {
        let _ = (items, app_name, publisher);
        Ok(CleanupResult {
            success: false,
            message: "清理功能仅支持 Windows 系统".to_string(),
            cleaned_count: 0,
            failed_items: Vec::new(),
        })
    }
}

// ============================================================================
// 卸载命令解析与执行
// ============================================================================

#[cfg(windows)]
fn resolve_uninstall_commands(input: &UninstallInput) -> Result<Vec<String>, String> {
    // 路径优先：如果前端传了 registry_path，直接按路径定位
    if let Some(registry_path) = input.registry_path.as_ref() {
        let cmds = expand_uninstall_command_candidates(read_uninstall_commands_from_registry_path(registry_path));
        if !cmds.is_empty() {
            return Ok(cmds);
        }
        return Err(format!("未在指定注册表路径找到可用卸载命令: {}", registry_path));
    }

    // 其次按 app_id（这里按 DisplayName 匹配）回查注册表
    if let Some(app_id) = input.app_id.as_ref() {
        let cmds = expand_uninstall_command_candidates(find_uninstall_commands_by_display_name(app_id));
        if !cmds.is_empty() {
            return Ok(cmds);
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

    let mut normalized_shell_cmd: Option<String> = None;
    let mut should_use_shell_fallback = true;
    let mut last_error: Option<String> = None;
    let mut allow_elevation_retry = false;

    // 方案 A：按“程序 + 参数”直接启动并等待结束
    if let Some((program, args)) = parse_program_and_args(cmd) {
        normalized_shell_cmd = Some(build_cmd_invocation(&program, &args));
        let display_cmd = if args.is_empty() {
            program.clone()
        } else {
            format!("{} {}", program, args.join(" "))
        };

        if is_definitely_invalid_program(&program) {
            return Err(format!("卸载命令无效，程序路径非法: {}", program));
        }

        let is_path_like = program.contains('\\') || program.contains(':');
        if is_path_like && !program.eq_ignore_ascii_case("msiexec") && !program.eq_ignore_ascii_case("msiexec.exe") {
            if !Path::new(&program).exists() {
                return Err(format!("卸载程序不存在: {}", program));
            }

            // 对可直接执行的本地卸载器，优先走原生进程启动
            // 避免 cmd 回退对引号/转义再次处理导致路径被误解析
            should_use_shell_fallback = false;
            allow_elevation_retry = true;
        }

        let working_dir = derive_working_dir(&program);
        eprintln!(
            "[orbit-file][uninstall] 直接启动: {} | cwd: {}",
            display_cmd,
            working_dir
                .as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "<default>".to_string())
        );

        match spawn_and_wait(&program, &args, working_dir.as_deref()) {
            Ok(_) => return Ok(()),
            Err(err) => {
                if allow_elevation_retry && is_elevation_required_error(&err) {
                    eprintln!(
                        "[orbit-file][uninstall] 检测到权限提升需求，尝试提权执行: {} {}",
                        program,
                        args.join(" ")
                    );

                    return spawn_elevated_and_wait(&program, &args, working_dir.as_deref());
                }
                last_error = Some(err);
            }
        }

        // 方案 A-2：对常见无参数卸载器追加静默参数重试
        let fallback_args = build_uninstaller_fallback_args(&program, &args);
        for retry_args in fallback_args {
            eprintln!(
                "[orbit-file][uninstall] 回退参数重试: {} {}",
                program,
                retry_args.join(" ")
            );
            match spawn_and_wait(&program, &retry_args, working_dir.as_deref()) {
                Ok(_) => return Ok(()),
                Err(err) => {
                    if allow_elevation_retry && is_elevation_required_error(&err) {
                        eprintln!(
                            "[orbit-file][uninstall] 参数重试触发提权执行: {} {}",
                            program,
                            retry_args.join(" ")
                        );

                        return spawn_elevated_and_wait(&program, &retry_args, working_dir.as_deref());
                    }
                    last_error = Some(err);
                }
            }
        }
    }

    // 已确认是本地可执行文件但直接执行失败时，不再回退 cmd，避免额外的误导性弹窗
    if !should_use_shell_fallback {
        return Err(last_error.unwrap_or_else(|| "卸载程序执行失败".to_string()));
    }

    let shell_cmd = normalized_shell_cmd.unwrap_or_else(|| cmd.to_string());

    // 方案 B：回退到 cmd /C 执行并等待
    eprintln!("[orbit-file][uninstall] 回退 cmd /C 执行: {}", shell_cmd);
    if spawn_cmd_shell_and_wait(&shell_cmd).is_ok() {
        return Ok(());
    }

    // 方案 C：使用 start /wait 兼容部分命令解释差异
    let start_wait_cmd = format!("start \"\" /wait {}", shell_cmd);
    eprintln!("[orbit-file][uninstall] 回退 start /wait 执行: {}", start_wait_cmd);
    spawn_cmd_shell_and_wait(&start_wait_cmd)
}

#[cfg(windows)]
fn spawn_cmd_shell_and_wait(shell_cmd: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let mut command = Command::new("cmd");
    command.arg("/D").arg("/S").arg("/C");
    command.raw_arg(shell_cmd);

    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 cmd 失败: {}", e))?;

    let status = child
        .wait()
        .map_err(|e| format!("等待 cmd 结束失败: {}", e))?;

    if !status.success() {
        let exit_code = status.code().unwrap_or(-1);
        eprintln!(
            "[orbit-file][uninstall] 进程退出: program=cmd code={} shell_cmd={}",
            exit_code,
            shell_cmd
        );
        return Err(format!("cmd 执行卸载命令失败，退出码: {}", exit_code));
    }

    Ok(())
}

#[cfg(windows)]
fn is_elevation_required_error(message: &str) -> bool {
    let normalized = message.to_lowercase();
    normalized.contains("os error 740")
        || normalized.contains("elevation")
        || normalized.contains("需要提升")
}

#[cfg(windows)]
fn spawn_elevated_and_wait(program: &str, args: &[String], working_dir: Option<&Path>) -> Result<(), String> {
    let escaped_program = escape_ps_single_quoted(program);
    let escaped_working_dir = working_dir
        .map(|dir| escape_ps_single_quoted(&dir.to_string_lossy()))
        .unwrap_or_default();

    let arg_clause = if args.is_empty() {
        String::new()
    } else {
        let quoted_args = args
            .iter()
            .map(|arg| format!("'{}'", escape_ps_single_quoted(arg)))
            .collect::<Vec<_>>()
            .join(", ");
        format!(" -ArgumentList @({})", quoted_args)
    };

    let script = if escaped_working_dir.is_empty() {
        format!(
            "$ErrorActionPreference='Stop'; \
             $p=Start-Process -FilePath '{}'{} -Verb RunAs -Wait -PassThru; \
             exit $p.ExitCode",
            escaped_program, arg_clause
        )
    } else {
        format!(
            "$ErrorActionPreference='Stop'; \
             $p=Start-Process -FilePath '{}'{} -WorkingDirectory '{}' -Verb RunAs -Wait -PassThru; \
             exit $p.ExitCode",
            escaped_program, arg_clause, escaped_working_dir
        )
    };

    let mut command = Command::new("powershell");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script);

    let mut child = command
        .spawn()
        .map_err(|e| format!("启动提权卸载失败: {}", e))?;

    let status = child
        .wait()
        .map_err(|e| format!("等待提权卸载结束失败: {}", e))?;

    if !status.success() {
        let code = status.code().unwrap_or(-1);
        if !is_tolerable_uninstall_exit_code(code) {
            return Err(format!("提权执行卸载失败，退出码: {}", code));
        }
    }

    Ok(())
}

#[cfg(windows)]
fn escape_ps_single_quoted(value: &str) -> String {
    value.replace("'", "''")
}

#[cfg(windows)]
fn build_cmd_invocation(program: &str, args: &[String]) -> String {
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(quote_for_cmd(program));
    parts.extend(args.iter().map(|arg| quote_for_cmd(arg)));
    parts.join(" ")
}

#[cfg(windows)]
fn quote_for_cmd(value: &str) -> String {
    if value.is_empty() {
        return "\"\"".to_string();
    }

    let needs_quotes = value
        .chars()
        .any(|ch| ch.is_whitespace() || matches!(ch, '&' | '|' | '<' | '>' | '^' | '(' | ')' | '"'));

    if !needs_quotes {
        return value.to_string();
    }

    format!("\"{}\"", value.replace('"', "\"\""))
}

#[cfg(windows)]
fn spawn_and_wait(program: &str, args: &[String], working_dir: Option<&Path>) -> Result<(), String> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(dir) = working_dir {
        command.current_dir(dir);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("启动卸载程序失败: {}", e))?;

    // 关键变更：等待子进程结束，确保后续残留扫描在卸载完成后执行
    let status = child
        .wait()
        .map_err(|e| format!("等待卸载程序结束失败: {}", e))?;

    if !status.success() {
        let exit_code = status.code().unwrap_or(-1);
        eprintln!(
            "[orbit-file][uninstall] 进程退出: program={} code={} args={}",
            program,
            exit_code,
            args.join(" ")
        );

        // cmd 返回非 0 代表命令解释/执行层失败，不应按可容忍退出码放过
        if program.eq_ignore_ascii_case("cmd") || program.eq_ignore_ascii_case("cmd.exe") {
            return Err(format!("cmd 执行卸载命令失败，退出码: {}", exit_code));
        }

        if !is_tolerable_uninstall_exit_code(exit_code) {
            return Err(format!("卸载程序执行失败，退出码: {}", exit_code));
        }
    }

    Ok(())
}

#[cfg(windows)]
fn derive_working_dir(program: &str) -> Option<PathBuf> {
    let path = Path::new(program);
    if path.exists() {
        return path.parent().map(|p| p.to_path_buf());
    }
    None
}

#[cfg(windows)]
fn build_uninstaller_fallback_args(program: &str, args: &[String]) -> Vec<Vec<String>> {
    if !args.is_empty() {
        return Vec::new();
    }

    let file_name = Path::new(program)
        .file_name()
        .map(|v| v.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    if !(file_name.contains("uninst") || file_name.contains("uninstall")) {
        return Vec::new();
    }

    vec![
        vec!["/S".to_string()],
        vec!["/silent".to_string()],
        vec!["/verysilent".to_string()],
        vec!["/qn".to_string()],
    ]
}

#[cfg(windows)]
fn is_tolerable_uninstall_exit_code(code: i32) -> bool {
    // 部分安装/卸载器会在主流程完成后返回非 0 退出码
    // 这里对常见“可继续后续扫描”的返回码做兼容
    matches!(code, 1 | 1605 | 1618 | 1641 | 3010)
}

#[cfg(windows)]
fn parse_program_and_args(command: &str) -> Option<(String, Vec<String>)> {
    let cmd = command.trim();
    if cmd.is_empty() {
        return None;
    }

    if let Some(rest) = cmd.strip_prefix('"') {
        let end = rest.find('"')?;
        let program = rest[..end].trim().to_string();
        let args_raw = rest[end + 1..].trim();
        return Some((program, split_command_args(args_raw)));
    }

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
            '"' => in_quotes = !in_quotes,
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
fn is_definitely_invalid_program(program: &str) -> bool {
    let p = program.trim().trim_matches('"').trim();
    p.is_empty() || p == "\\" || p == "\\\\" || p == "/"
}

// ============================================================================
// 残留扫描逻辑（与卸载逻辑解耦）
// ============================================================================

#[cfg(windows)]
fn scan_app_residue_internal(
    app_name: String,
    publisher: Option<String>,
    install_location: Option<String>,
) -> Result<Vec<LeftoverItem>, String> {
    let Some(context) = build_strict_scan_context(&app_name, publisher.as_deref(), install_location.as_deref()) else {
        return Ok(Vec::new());
    };

    let mut roots = build_scan_roots(&app_name, install_location);
    roots.sort();
    roots.dedup();

    let mut items = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    scan_filesystem_residue(&roots, &context, &mut items, &mut seen);
    scan_registry_residue(&context, &mut items, &mut seen);

    Ok(items)
}

#[cfg(windows)]
fn build_keywords(app_name: &str, publisher: Option<&str>, install_location: Option<&str>) -> Vec<String> {
    let mut values = vec![sanitize_search_text(app_name)];
    if let Some(pub_name) = publisher {
        values.push(sanitize_search_text(pub_name));
    }

    if let Some(location) = install_location {
        values.push(sanitize_search_text(location));
    }

    let mut keywords = Vec::new();
    for raw in values {
        if raw.is_empty() {
            continue;
        }
        for part in raw.split(|c: char| !c.is_alphanumeric()) {
            let token = part.trim().to_lowercase();
            if is_meaningful_keyword(&token) && !keywords.contains(&token) {
                keywords.push(token);
            }
        }
    }
    keywords
}

#[cfg(windows)]
fn is_meaningful_keyword(token: &str) -> bool {
    if token.is_empty() {
        return false;
    }

    let generic_ascii_words = [
        "app", "apps", "group", "company", "co", "ltd", "inc", "corp", "corporation", "limited", "tech",
        "technology", "software", "network", "internet", "china", "beijing", "shanghai", "windows", "microsoft",
    ];
    let generic_cn_words = ["公司", "集团", "技术", "网络", "软件", "中国", "有限", "科技"];

    if generic_ascii_words.iter().any(|w| *w == token) {
        return false;
    }

    if generic_cn_words.iter().any(|w| *w == token) {
        return false;
    }

    if token.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return token.len() >= 3;
    }

    token.chars().count() >= 2
}

#[cfg(windows)]
fn build_scan_roots(app_name: &str, install_location: Option<String>) -> Vec<String> {
    let mut roots = vec![
        std::env::var("APPDATA").unwrap_or_default(),
        std::env::var("LOCALAPPDATA").unwrap_or_default(),
        r"C:\ProgramData".to_string(),
    ];

    if let Some(path) = install_location {
        if !path.trim().is_empty() {
            roots.push(path);
        }
    }

    for path in find_install_locations_by_app_name(app_name) {
        roots.push(path);
    }

    roots.into_iter().filter(|p| !p.trim().is_empty()).collect()
}

#[cfg(windows)]
fn scan_filesystem_residue(
    roots: &[String],
    context: &StrictScanContext,
    output: &mut Vec<LeftoverItem>,
    seen: &mut HashSet<String>,
) {
    for root in roots {
        let root_path = Path::new(root);
        if !root_path.exists() || !root_path.is_dir() || is_blacklisted_path(root_path) {
            continue;
        }

        for entry in WalkDir::new(root_path)
            .max_depth(5)
            .into_iter()
            .filter_map(|entry| entry.ok())
        {
            if entry.depth() == 0 {
                continue;
            }

            let path = entry.path();
            if is_blacklisted_path(path) {
                continue;
            }

            if !matches_strict_leftover_path(path, context) {
                continue;
            }

            let canonical = normalize_path(path);
            if seen.contains(&canonical) {
                continue;
            }

            seen.insert(canonical);

            let item_type = if path.is_dir() { "Folder" } else { "File" };
            let size_mb = if path.is_dir() {
                bytes_to_mb(compute_dir_size(path))
            } else {
                bytes_to_mb(path.metadata().map(|m| m.len()).unwrap_or(0))
            };

            output.push(LeftoverItem {
                path: path.to_string_lossy().to_string(),
                item_type: item_type.to_string(),
                size_mb,
                selected: false,
            });
        }
    }
}

#[cfg(windows)]
fn scan_registry_residue(
    context: &StrictScanContext,
    output: &mut Vec<LeftoverItem>,
    seen: &mut HashSet<String>,
) {
    let registry_roots: [(HKEY, &str, &str); 3] = [
        (HKEY_LOCAL_MACHINE, "HKLM", r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, "HKLM", r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER, "HKCU", r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];

    for (hkey, hive_name, root_path) in registry_roots {
        let uninstall_root = match RegKey::predef(hkey).open_subkey_with_flags(root_path, KEY_READ) {
            Ok(v) => v,
            Err(_) => continue,
        };

        for subkey_name in uninstall_root.enum_keys().filter_map(|x| x.ok()) {
            let full_sub_path = format!(r"{}\{}", root_path, subkey_name);
            let subkey = match RegKey::predef(hkey).open_subkey_with_flags(&full_sub_path, KEY_READ) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if !matches_registry_key_strict(&subkey, context) {
                continue;
            }

            let registry_path = format!(r"{}\{}", hive_name, full_sub_path);
            let canonical = registry_path.to_lowercase();
            if seen.contains(&canonical) {
                continue;
            }

            seen.insert(canonical);
            output.push(LeftoverItem {
                path: registry_path,
                item_type: "Registry".to_string(),
                size_mb: 0.0,
                selected: false,
            });
        }
    }
}

#[cfg(windows)]
fn matches_registry_key_strict(key: &RegKey, context: &StrictScanContext) -> bool {
    let display_name: String = key.get_value("DisplayName").unwrap_or_default();
    let display_name = normalize_match_text(&display_name);
    if !display_name.is_empty() && display_name == context.app_name_exact {
        return true;
    }

    let uninstall_candidates = [
        key.get_value::<String, _>("UninstallString").unwrap_or_default(),
        key.get_value::<String, _>("QuietUninstallString").unwrap_or_default(),
    ];

    uninstall_candidates
        .into_iter()
        .map(|v| normalize_windows_path(&v))
        .filter(|v| !v.is_empty())
        .any(|value| {
            context
                .uninstall_path_hints
                .iter()
                .any(|hint| !hint.is_empty() && value.contains(hint))
        })
}

#[cfg(windows)]
fn matches_strict_leftover_path(path: &Path, context: &StrictScanContext) -> bool {
    let normalized_path = normalize_path(path);
    if BLACKLIST.iter().any(|token| normalized_path.contains(token)) {
        return false;
    }

    if let Some(install_location) = context.install_location.as_ref() {
        if normalized_path == *install_location {
            return true;
        }
    }

    let components: Vec<String> = path
        .components()
        .map(|c| normalize_match_text(&c.as_os_str().to_string_lossy()))
        .filter(|v| !v.is_empty())
        .collect();

    if components.is_empty() {
        return false;
    }

    let app_indexes: Vec<usize> = components
        .iter()
        .enumerate()
        .filter_map(|(idx, value)| if *value == context.app_folder_name { Some(idx) } else { None })
        .collect();

    if app_indexes.is_empty() {
        return false;
    }

    if let Some(publisher) = context.publisher_name.as_ref() {
        if normalized_path.contains(publisher) {
            let publisher_index = components
                .iter()
                .position(|value| value.contains(publisher) || publisher.contains(value));

            // Rule B: 命中发布商目录时，必须在更深层出现精确应用目录名
            match publisher_index {
                Some(pub_idx) if app_indexes.iter().any(|app_idx| *app_idx > pub_idx) => return true,
                Some(_) => return false,
                None => return false,
            }
        }
    }

    // Rule A: 任意层出现精确应用目录名，才视为残留
    true
}

#[cfg(windows)]
fn collect_uninstall_path_hints(app_name_exact: &str, install_location: Option<&str>) -> Vec<String> {
    let mut hints: Vec<String> = Vec::new();

    if let Some(location) = install_location {
        let normalized = normalize_windows_path(location);
        if !normalized.is_empty() {
            hints.push(normalized);
        }
    }

    let registry_roots: [(HKEY, &str); 3] = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];

    for (hkey, path) in registry_roots {
        let uninstall_key = match RegKey::predef(hkey).open_subkey_with_flags(path, KEY_READ) {
            Ok(v) => v,
            Err(_) => continue,
        };

        for subkey_name in uninstall_key.enum_keys().filter_map(|x| x.ok()) {
            let subkey = match uninstall_key.open_subkey_with_flags(&subkey_name, KEY_READ) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let display_name: String = subkey.get_value("DisplayName").unwrap_or_default();
            if normalize_match_text(&display_name) != app_name_exact {
                continue;
            }

            for command in [
                subkey.get_value::<String, _>("UninstallString").unwrap_or_default(),
                subkey.get_value::<String, _>("QuietUninstallString").unwrap_or_default(),
            ] {
                if let Some(path_hint) = extract_uninstall_path_hint(&command) {
                    hints.push(path_hint);
                }
            }
        }
    }

    hints.sort();
    hints.dedup();
    hints
}

#[cfg(windows)]
fn extract_uninstall_path_hint(command: &str) -> Option<String> {
    let (program, _) = parse_program_and_args(command)?;
    let normalized = normalize_windows_path(&program);
    if normalized.is_empty() {
        return None;
    }

    // MSI GUID 这类非路径命令不作为路径证据
    if normalized.contains("msiexec") && !normalized.contains('\\') {
        return None;
    }

    Some(normalized)
}

#[cfg(windows)]
fn find_install_locations_by_app_name(app_name: &str) -> Vec<String> {
    let query = normalize_match_text(app_name);
    if query.is_empty() {
        return Vec::new();
    }

    let mut paths = Vec::new();
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
            if normalize_match_text(&display_name) != query {
                continue;
            }

            let location: String = subkey.get_value("InstallLocation").unwrap_or_default();
            let normalized = sanitize_search_text(&location);
            if !normalized.is_empty() {
                paths.push(normalized);
            }
        }
    }

    paths
}

#[cfg(windows)]
fn compute_dir_size(path: &Path) -> u64 {
    WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|entry| entry.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .sum()
}

#[cfg(windows)]
fn bytes_to_mb(bytes: u64) -> f64 {
    ((bytes as f64) / 1024.0 / 1024.0 * 100.0).round() / 100.0
}

#[cfg(windows)]
fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

#[cfg(windows)]
fn is_blacklisted_path(path: &Path) -> bool {
    let normalized = normalize_path(path);

    if normalized == r"c:\windows"
        || normalized.starts_with(r"c:\windows\")
        || normalized == r"c:\windows\system32"
        || normalized.starts_with(r"c:\windows\system32\")
        || normalized == r"c:\program files"
        || normalized == r"c:\program files (x86)"
    {
        return true;
    }

    if BLACKLIST.iter().any(|token| normalized.contains(token)) {
        return true;
    }

    // 防止删除盘符根目录
    if path.parent().is_none() {
        return true;
    }

    false
}

#[cfg(windows)]
fn is_blacklisted_registry_path(_hkey: HKEY, sub_path: &str) -> bool {
    let normalized = sub_path.trim().to_lowercase();

    // 防止删除根级 Software 节点
    if normalized == "software" {
        return true;
    }

    // 防止误删系统核心注册表路径
    if normalized == r"software\microsoft" || normalized.starts_with(r"software\microsoft\windows") {
        return true;
    }

    false
}

// ============================================================================
// 注册表/命令辅助函数
// ============================================================================

#[cfg(windows)]
fn read_uninstall_commands_from_registry_path(path: &str) -> Vec<String> {
    let (hkey, sub_path) = match parse_registry_path(path) {
        Some(v) => v,
        None => return Vec::new(),
    };
    let key = match RegKey::predef(hkey).open_subkey(sub_path) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut cmds = Vec::new();

    let quiet: String = key.get_value("QuietUninstallString").unwrap_or_default();
    if is_valid_uninstall_command(&quiet) {
        cmds.push(quiet.trim().to_string());
    }

    let normal: String = key.get_value("UninstallString").unwrap_or_default();
    if is_valid_uninstall_command(&normal) {
        let normalized = normal.trim().to_string();
        if !cmds.iter().any(|v| v.eq_ignore_ascii_case(&normalized)) {
            cmds.push(normalized);
        }
    }

    cmds
}

#[cfg(windows)]
fn find_uninstall_by_display_name(app_id: &str) -> Option<String> {
    find_uninstall_commands_by_display_name(app_id).into_iter().next()
}

#[cfg(windows)]
fn find_uninstall_commands_by_display_name(app_id: &str) -> Vec<String> {
    let query = app_id.trim().to_lowercase();
    if query.is_empty() {
        return Vec::new();
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

            let mut cmds = Vec::new();

            let quiet: String = subkey.get_value("QuietUninstallString").unwrap_or_default();
            if is_valid_uninstall_command(&quiet) {
                cmds.push(quiet.trim().to_string());
            }

            let normal: String = subkey.get_value("UninstallString").unwrap_or_default();
            if is_valid_uninstall_command(&normal) {
                let normalized = normal.trim().to_string();
                if !cmds.iter().any(|v| v.eq_ignore_ascii_case(&normalized)) {
                    cmds.push(normalized);
                }
            }

            if !cmds.is_empty() {
                return cmds;
            }
        }
    }

    Vec::new()
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

    let normalized = trimmed.trim_matches('"').trim();
    if normalized.is_empty() {
        return false;
    }

    normalized != "\\" && normalized != "\\\\" && normalized != "/"
}
