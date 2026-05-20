// 应用迁移模块
// 负责应用目录迁移、空间校验、进度上报、回滚与历史写入

use std::fs;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use sysinfo::Disks;
use tauri::Emitter;
use walkdir::WalkDir;

use crate::models::{MigrationRecordType, MigrationResult};
use crate::utils;

#[cfg(windows)]
use std::os::windows::fs::symlink_dir;

/// 迁移进度事件（发送到前端）
#[derive(Clone, Serialize)]
pub struct MigrationProgressEvent {
    /// 任务标识（源路径），前端用于区分批量迁移中各任务的进度
    pub task_id: String,
    /// 当前进度百分比 0.0 ~ 100.0
    pub percent: f64,
    /// 当前步骤: counting | copying | verifying | linking | done
    pub step: String,
    /// 描述消息
    pub message: String,
    /// 已复制字节数
    pub copied_size: u64,
    /// 总字节数
    pub total_size: u64,
}

/// 获取指定磁盘的可用空间
/// 使用最长前缀匹配，避免多挂载点场景（如 WSL/Subst 虚拟盘）
/// 回退到错误磁盘
fn get_available_space(path: &Path) -> u64 {
    let disks = Disks::new_with_refreshed_list();
    let path_str = path.to_string_lossy().to_uppercase();

    disks.list()
        .iter()
        .filter_map(|disk| {
            let mount = disk.mount_point().to_string_lossy().to_uppercase();
            let mount_clean = mount.trim_end_matches('\\');
            // 必须匹配完整路径分隔边界，避免 C: 误匹配 CD: 或 C:\Mount\Disk2
            let is_match = path_str == mount_clean
                || (path_str.starts_with(mount_clean)
                    && path_str.as_bytes().get(mount_clean.len()) == Some(&b'\\'));
            if is_match {
                Some((mount_clean.len(), disk.available_space()))
            } else {
                None
            }
        })
        .max_by_key(|(len, _)| *len) // 选最长（最具体）的挂载点匹配
        .map(|(_, space)| space)
        .unwrap_or(0)
}

/// 发送进度事件到前端
fn emit_progress(
    app_handle: &tauri::AppHandle,
    task_id: &str,
    percent: f64,
    step: &str,
    message: &str,
    copied_size: u64,
    total_size: u64,
) {
    let _ = app_handle.emit("migration-progress", MigrationProgressEvent {
        task_id: task_id.to_string(),
        percent,
        step: step.to_string(),
        message: message.to_string(),
        copied_size,
        total_size,
    });
}


/// 分块复制单个文件，在每 64KB 块之间检查取消标志
/// 避免大文件（数 GB）的 fs::copy 阻塞期间无法取消和上报进度
/// 权限拒绝时跳过该文件并返回 0，不中断整体迁移
fn copy_file_with_cancel(
    src: &Path,
    dest: &Path,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<u64, String> {
    // 无法打开的文件（权限拒绝/被锁定）静默跳过，不中断整体迁移
    let file = match fs::File::open(src) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            log_warn!("migration", "跳过无权限文件: {}", src.display());
            return Ok(0);
        }
        Err(e) => return Err(format!("打开源文件失败 {}: {}", src.display(), e)),
    };
    let file_size = file.metadata()
        .map_err(|e| format!("读取文件元数据失败 {}: {}", src.display(), e))?
        .len();

    // 小文件（< 1MB）直接使用 fs::copy，免去分块开销
    if file_size < 1024 * 1024 {
        if let Err(e) = fs::copy(src, dest) {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                log_warn!("migration", "跳过无权限小文件: {}", src.display());
                return Ok(0);
            }
            return Err(format!("复制文件失败 {}: {}", src.display(), e));
        }
        return Ok(file_size);
    }

    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let dest_file = fs::File::create(dest)
        .map_err(|e| format!("创建目标文件失败 {}: {}", dest.display(), e))?;
    let mut writer = BufWriter::with_capacity(64 * 1024, dest_file);
    let mut buffer = [0u8; 64 * 1024];
    let mut copied: u64 = 0;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            // 删除未完成的目标文件，避免残留
            let _ = fs::remove_file(dest);
            return Err("用户取消了迁移".to_string());
        }
        let bytes_read = reader.read(&mut buffer)
            .map_err(|e| format!("读取文件失败 {} (已复制 {}/{}): {}", src.display(), copied, file_size, e))?;
        if bytes_read == 0 {
            break;
        }
        writer.write_all(&buffer[..bytes_read])
            .map_err(|e| format!("写入文件失败 {}: {}", dest.display(), e))?;
        copied += bytes_read as u64;
    }
    writer.flush()
        .map_err(|e| format!("刷新文件缓冲区失败 {}: {}", dest.display(), e))?;

    Ok(copied)
}

/// 带进度上报和取消支持的文件复制
///
/// 替代 fs_extra::copy_items，逐个文件复制以便：
/// 1. 在每个文件 / 每 64KB 之间检查取消标志
/// 2. 按实际复制量上报进度百分比
///
/// 返回 (总文件大小, 因权限拒绝跳过的字节数)
fn copy_dir_with_progress(
    source: &Path,
    target: &Path,
    task_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    app_handle: &tauri::AppHandle,
) -> Result<(u64, u64), String> {
    // 阶段 1：遍历统计文件列表和总大小
    emit_progress(app_handle, task_id, 0.0, "counting", "正在扫描文件...", 0, 0);

    let mut file_list: Vec<(PathBuf, PathBuf, u64)> = Vec::new();
    let mut total_size: u64 = 0;

    for entry in WalkDir::new(source).into_iter().filter_map(|e| e.ok()) {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("用户取消了迁移".to_string());
        }
        if entry.file_type().is_file() {
            let rel_path = entry.path().strip_prefix(source)
                .map_err(|e| format!("路径解析失败: {}", e))?;
            let dest = target.join(rel_path);
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            total_size += size;
            file_list.push((entry.path().to_path_buf(), dest, size));
        }
    }

    if total_size == 0 {
        emit_progress(app_handle, task_id, 100.0, "copying", "源目录为空，跳过复制", 0, 0);
        return Ok((0, 0));
    }

    // 阶段 2：逐个复制文件，上报进度
    let total_files = file_list.len() as u64;
    let mut copied_size: u64 = 0;
    let mut skipped_size: u64 = 0;
    let mut last_report_pct: u64 = 0;

    for (idx, (src, dest, size)) in file_list.iter().enumerate() {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("用户取消了迁移".to_string());
        }

        // 创建目标父目录
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
        }

        // 使用分块复制替代 fs::copy，确保大文件复制期间仍可取消
        // 返回值：实际复制的字节数，权限拒绝时返回 0
        let actually_copied = copy_file_with_cancel(src, dest, cancel_flag)?;
        if actually_copied == 0 && *size > 0 {
            // 权限拒绝跳过的文件，记录其大小用于完整性校验容差
            skipped_size += size;
        }

        copied_size += size;

        // 每 1% 或每 50 个文件上报一次进度（避免过于频繁的事件）
        let current_pct = if total_size > 0 {
            ((copied_size as f64 / total_size as f64) * 100.0) as u64
        } else {
            100
        };

        if current_pct > last_report_pct || idx as u64 % 50 == 0 || idx == file_list.len() - 1 {
            last_report_pct = current_pct;
            emit_progress(
                app_handle,
                task_id,
                current_pct as f64,
                "copying",
                &format!("正在复制文件 ({}/{})", idx + 1, total_files),
                copied_size,
                total_size,
            );
        }
    }

    Ok((total_size, skipped_size))
}

/// 核心迁移命令
/// 将应用从源路径迁移到目标路径，并创建 Windows 目录联接（Junction）
///
/// 新增参数：
/// - `cancel_flag`: 共享的取消标志，前端可通过 cancel_migration 命令设置
/// - `app_handle`: Tauri AppHandle，用于发送进度事件
pub fn migrate_app(
    app_name: String,
    source: String,
    target_parent: String,
    cancel_flag: &Arc<AtomicBool>,
    app_handle: &tauri::AppHandle,
    record_type: MigrationRecordType,
    force_overwrite: bool,
) -> Result<MigrationResult, String> {
    #[cfg(windows)]
    {
        let source_path = Path::new(&source);
        let target_parent_path = Path::new(&target_parent);

        // 步骤 0: 基础验证
        if !source_path.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("源路径不存在: {}", source),
                new_path: None,
            });
        }

        if !source_path.is_dir() {
            return Ok(MigrationResult {
                success: false,
                message: "源路径必须是一个目录".to_string(),
                new_path: None,
            });
        }

        if !target_parent_path.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("目标路径不存在: {}", target_parent),
                new_path: None,
            });
        }

        let folder_name = source_path
            .file_name()
            .ok_or("无法获取源文件夹名称")?
            .to_string_lossy()
            .to_string();

        let target_path = target_parent_path.join(&folder_name);
        let target_path_str = target_path.to_string_lossy().to_string();

        if target_path.exists() {
            if !force_overwrite {
                // 判断是否为失败迁移残留：source 是普通目录且 target 也存在
                // 区别于 JUNCTION_LOOP 场景（source 仍是 Junction 指向 target）
                let looks_like_failed_migration = source_path.is_dir()
                    && !crate::utils::is_junction(source_path)
                    && target_path.is_dir();

                let msg = if looks_like_failed_migration {
                    format!("TARGET_EXISTS_RETRY:{}", target_path_str)
                } else {
                    format!("TARGET_EXISTS:{}", target_path_str)
                };

                return Ok(MigrationResult {
                    success: false,
                    message: msg,
                    new_path: None,
                });
            }

            // force_overwrite 安全检查：源路径是否为指向目标路径的 Junction
            // 场景：迁移成功但恢复失败，源路径仍是 Junction 指向目标盘数据
            // 此时删除目标 = 删除唯一数据副本，源 Junction 变成悬空链接
            let source_is_junction_to_target = crate::utils::is_junction(source_path) && {
                crate::utils::get_junction_target(source_path)
                    .map(|t| {
                        t.to_lowercase().trim_end_matches('\\').to_string()
                        == target_path_str.to_lowercase().trim_end_matches('\\').to_string()
                    })
                    .unwrap_or(false)
            };

            if source_is_junction_to_target {
                return Ok(MigrationResult {
                    success: false,
                    message: format!("JUNCTION_LOOP:{}", target_path_str),
                    new_path: None,
                });
            }

            // 安全：源路径非 Junction 或指向不同目标，可安全删除目标残留
            log_warn!("migration", "force_overwrite: 删除残留目标目录 {}", target_path_str);
            fs::remove_dir_all(&target_path)
                .map_err(|e| format!(
                    "无法删除残留目录: {}。请手动删除后重试。原因: {}",
                    target_path_str, e
                ))?;
        }

        // 步骤 0.5: 检测源路径是否被进程占用（占用时 symlink_dir 必然失败）
        // 前端 AppMigration.tsx 已有独立的 check_process_locks 调用，
        // 此处作为后端兜底保护，同时覆盖文件夹迁移等未在前端检测的入口
        {
            let mut sys = sysinfo::System::new_all();
            sys.refresh_all();
            let source_lower = source.to_lowercase();
            let running: Vec<String> = sys.processes().values()
                .filter_map(|p| {
                    p.exe().and_then(|exe| {
                        if exe.to_string_lossy().to_lowercase().starts_with(&source_lower) {
                            Some(p.name().to_string_lossy().to_string())
                        } else {
                            None
                        }
                    })
                })
                .collect();

            if !running.is_empty() {
                return Ok(MigrationResult {
                    success: false,
                    message: format!(
                        "检测到以下程序正在使用该目录：\n{}\n\n\
                         请关闭上述程序后重试。",
                        running.join("、")
                    ),
                    new_path: None,
                });
            }
        }

        // 步骤 0.5.1：及时响应取消（sysinfo 刷新可能较慢）
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("用户取消了迁移".to_string());
        }

        // 步骤 1: 空间检查
        emit_progress(app_handle, &source, 0.0, "counting", "正在计算源文件夹大小...", 0, 0);

        let source_size = utils::get_dir_size_safe(source_path);

        let available_space = get_available_space(target_parent_path);
        // 1.2× 源大小 + 100MB 最小预留，避免目标盘被填满
        let required_space = (source_size as f64 * 1.2) as u64 + 100 * 1024 * 1024;

        if available_space < required_space {
            return Ok(MigrationResult {
                success: false,
                message: format!(
                    "目标磁盘空间不足。需要: {:.2} GB，可用: {:.2} GB",
                    required_space as f64 / 1024.0 / 1024.0 / 1024.0,
                    available_space as f64 / 1024.0 / 1024.0 / 1024.0
                ),
                new_path: None,
            });
        }

        // 步骤 1.1：及时响应取消（get_dir_size_safe 对大目录可能耗时较长）
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("用户取消了迁移".to_string());
        }

        // 步骤 2: 复制文件（带进度上报和取消支持）
        // 先创建目标目录的父目录结构
        fs::create_dir_all(&target_path)
            .map_err(|e| format!("创建目标目录失败: {}", e))?;

        let (total_size, skipped_size) = match copy_dir_with_progress(
            source_path, &target_path, &source, cancel_flag, app_handle,
        ) {
            Ok((total, skipped)) => (total, skipped),
            Err(e) => {
                // 取消或复制错误：清理已创建的目标目录，避免残留半成品
                let _ = fs::remove_dir_all(&target_path);
                return Ok(MigrationResult {
                    success: false,
                    message: e,
                    new_path: None,
                });
            }
        };

        // 步骤 3: 完整性校验
        // 使用实际复制量（去除跳过文件）作为预期基准，避免权限拒绝文件导致误报
        emit_progress(app_handle, &source, 90.0, "verifying", "正在校验文件完整性...", source_size, source_size);

        let target_size = utils::get_dir_size_safe(&target_path);
        let expected_target = total_size.saturating_sub(skipped_size);
        // 容差 = 跳过体积 + 1MB 元数据浮动，但不超过源大小的 5%
        // 避免大面积权限拒绝（如 DRM 保护文件）时容差过宽导致漏检
        let max_tolerance = (total_size as f64 * 0.05) as u64 + 1024 * 1024;
        let tolerance = skipped_size.min(max_tolerance) + 1024 * 1024;

        if (target_size as i64 - expected_target as i64).abs() > tolerance as i64 {
            let _ = fs::remove_dir_all(&target_path);
            return Ok(MigrationResult {
                success: false,
                message: format!(
                    "文件完整性校验失败。预期: {} 字节，实际: {} 字节，跳过: {} 字节",
                    expected_target, target_size, skipped_size
                ),
                new_path: None,
            });
        }

        // 步骤 4: 备份原目录
        emit_progress(app_handle, &source, 93.0, "linking", "正在创建目录链接...", source_size, source_size);

        let backup_path = source_path.with_file_name(format!("{}_viap_backup", folder_name));
        let backup_path_str = backup_path.to_string_lossy().to_string();

        // 清理上一次失败残留的备份目录，避免 rename 时触发 ERROR_DIR_NOT_EMPTY
        if backup_path.exists() {
            let _ = fs::remove_dir_all(&backup_path);
        }

        // 尝试快速路径：同卷 rename（原子操作，0 开销）
        match fs::rename(source_path, &backup_path) {
            Ok(_) => {}
            Err(e) => {
                let _ = fs::remove_dir_all(&target_path);
                let msg = match e.kind() {
                    std::io::ErrorKind::PermissionDenied => format!(
                        "无法备份原目录：权限不足 (拒绝访问)。\n\
                         路径: {}\n\
                         原因: 该目录位于系统保护区域（如 Program Files），重命名需要管理员权限。\n\
                         请以管理员身份重新运行应用后重试。",
                        source
                    ),
                    _ => format!(
                        "无法备份原目录: {} (os error {})。\n\
                         路径: {}\n\
                         可能原因: 目录被其他程序占用或有残留文件，请重启后重试。",
                        e,
                        e.raw_os_error().unwrap_or(0),
                        source
                    ),
                };
                return Ok(MigrationResult {
                    success: false,
                    message: msg,
                    new_path: None,
                });
            }
        }

        // 步骤 5: 创建目录联接
        match symlink_dir(&target_path, source_path) {
            Ok(_) => {
                // 步骤 6: 清理备份
                emit_progress(app_handle, &source, 97.0, "linking", "正在清理临时文件...", source_size, source_size);

                let backup_cleanup_err = fs::remove_dir_all(&backup_path).err();
                if let Some(ref e) = backup_cleanup_err {
                    log_warn!("migration", "无法删除备份目录 {}: {}", backup_path_str, e);
                }

                // 步骤 7: 写入迁移历史
                let is_app = matches!(record_type, MigrationRecordType::App);
                if let Err(e) = crate::storage::history::add_migration_record(
                    &app_name,
                    &source,
                    &target_path_str,
                    source_size,
                    record_type,
                ) {
                    log_warn!("migration", "保存迁移记录失败: {}", e);
                }
                // 写入兜底元数据：仅对应用类型记录，确保扫描器遗漏时仍能识别
                if is_app {
                    crate::storage::migrated_app_metadata::add_migrated_app(
                        &app_name, &source, &target_path_str,
                    );
                }

                emit_progress(app_handle, &source, 100.0, "done", "迁移完成", source_size, source_size);

                // 备份清理失败时在成功消息中附加提示，避免用户以为已释放空间
                let mut success_msg = format!("迁移成功！应用已从 {} 迁移到 {}", source, target_path_str);
                if backup_cleanup_err.is_some() {
                    success_msg.push_str(&format!(
                        "\n注意：临时备份目录未能自动删除，请手动清理以释放空间：\n{}",
                        backup_path_str
                    ));
                }

                Ok(MigrationResult {
                    success: true,
                    message: success_msg,
                    new_path: Some(target_path_str),
                })
            }
            Err(e) => {
                // 回滚语义：还原到迁移前状态，不留中间状态
                let source_restored = fs::rename(&backup_path, source_path).is_ok();

                if !source_restored {
                    // 原目录恢复失败：target 是唯一数据副本，绝对不能删
                    return Ok(MigrationResult {
                        success: false,
                        message: format!(
                            "严重错误：创建链接失败（{}），且无法自动恢复原目录。\n\n\
                             您的数据完整保存在：{}\n\
                             请手动将该目录移回：{}\n\
                             备份目录位于：{}",
                            e, target_path_str, source, backup_path_str
                        ),
                        new_path: None,
                    });
                }

                // 原目录已恢复，安全删除 target 副本，还原到迁移前状态
                if let Err(cleanup_err) = fs::remove_dir_all(&target_path) {
                    // 删除失败：两边都有数据，提示用户手动清理
                    log_warn!("migration", "回滚时无法删除目标目录 {}: {}", target_path_str, cleanup_err);
                    return Ok(MigrationResult {
                        success: false,
                        message: format!(
                            "创建目录链接失败：{}\n\
                             原目录已自动恢复，数据完好无损。\n\n\
                             但目标位置的副本未能自动删除，请手动清理以释放空间：\n{}\n\n\
                             可能原因：应用正在后台运行，请完全关闭后重试。",
                            e, target_path_str
                        ),
                        new_path: None,
                    });
                }

                // 回滚完成：原目录恢复，target 副本已删，状态与迁移前完全一致
                Ok(MigrationResult {
                    success: false,
                    message: format!(
                        "创建目录链接失败：{}\n\
                         原目录已自动恢复，数据完好无损，未产生任何残留。\n\n\
                         可能原因：应用正在后台运行，请完全关闭后重试。",
                        e
                    ),
                    new_path: None,
                })
            }
        }
    }

    #[cfg(not(windows))]
    {
        Ok(MigrationResult {
            success: false,
            message: "迁移功能仅支持 Windows 系统".to_string(),
            new_path: None,
        })
    }
}
