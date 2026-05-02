// 应用迁移模块
// 负责应用目录迁移、空间校验、进度上报、回滚与历史写入

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use fs_extra::dir::get_size;
use serde::Serialize;
use sysinfo::Disks;
use tauri::Emitter;
use walkdir::WalkDir;

use crate::models::{MigrationRecordType, MigrationResult};

#[cfg(windows)]
use std::os::windows::fs::symlink_dir;

/// 迁移进度事件（发送到前端）
#[derive(Clone, Serialize)]
pub struct MigrationProgressEvent {
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
fn get_available_space(path: &Path) -> u64 {
    let disks = Disks::new_with_refreshed_list();
    let path_str = path.to_string_lossy().to_uppercase();

    for disk in disks.list() {
        let mount = disk.mount_point().to_string_lossy().to_uppercase();
        if path_str.starts_with(&mount) || path_str.starts_with(&mount.replace("\\", "")) {
            return disk.available_space();
        }
    }
    0
}

/// 发送进度事件到前端
fn emit_progress(
    app_handle: &tauri::AppHandle,
    percent: f64,
    step: &str,
    message: &str,
    copied_size: u64,
    total_size: u64,
) {
    let _ = app_handle.emit("migration-progress", MigrationProgressEvent {
        percent,
        step: step.to_string(),
        message: message.to_string(),
        copied_size,
        total_size,
    });
}

/// 带进度上报和取消支持的文件复制
///
/// 替代 fs_extra::copy，逐个文件复制以便：
/// 1. 在每个文件之间检查取消标志
/// 2. 按实际复制量上报进度百分比
fn copy_dir_with_progress(
    source: &Path,
    target: &Path,
    cancel_flag: &Arc<AtomicBool>,
    app_handle: &tauri::AppHandle,
) -> Result<u64, String> {
    // 阶段 1：遍历统计文件列表和总大小
    emit_progress(app_handle, 0.0, "counting", "正在扫描文件...", 0, 0);

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
        emit_progress(app_handle, 100.0, "copying", "源目录为空，跳过复制", 0, 0);
        return Ok(0);
    }

    // 阶段 2：逐个复制文件，上报进度
    let total_files = file_list.len() as u64;
    let mut copied_size: u64 = 0;
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

        fs::copy(src, dest)
            .map_err(|e| format!("复制文件失败 {}: {}", src.display(), e))?;

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
                current_pct as f64,
                "copying",
                &format!("正在复制文件 ({}/{})", idx + 1, total_files),
                copied_size,
                total_size,
            );
        }
    }

    Ok(total_size)
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
            return Ok(MigrationResult {
                success: false,
                message: format!("目标路径已存在: {}", target_path_str),
                new_path: None,
            });
        }

        // 步骤 1: 空间检查
        emit_progress(app_handle, 0.0, "counting", "正在计算源文件夹大小...", 0, 0);

        let source_size = get_size(source_path)
            .map_err(|e| format!("无法计算源文件夹大小: {}", e))?;

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

        // 步骤 2: 复制文件（带进度上报和取消支持）
        // 先创建目标目录的父目录结构
        fs::create_dir_all(&target_path)
            .map_err(|e| format!("创建目标目录失败: {}", e))?;

        copy_dir_with_progress(source_path, &target_path, cancel_flag, app_handle)?;

        // 步骤 3: 完整性校验
        emit_progress(app_handle, 90.0, "verifying", "正在校验文件完整性...", source_size, source_size);

        let target_size = get_size(&target_path)
            .map_err(|e| format!("无法计算目标文件夹大小: {}", e))?;
        let size_diff = (source_size as i64 - target_size as i64).abs();
        let tolerance = (source_size as f64 * 0.01) as i64;

        if size_diff > tolerance {
            let _ = fs::remove_dir_all(&target_path);
            return Ok(MigrationResult {
                success: false,
                message: format!(
                    "文件完整性校验失败。源大小: {} 字节，目标大小: {} 字节",
                    source_size, target_size
                ),
                new_path: None,
            });
        }

        // 步骤 4: 备份原目录
        emit_progress(app_handle, 93.0, "linking", "正在创建目录链接...", source_size, source_size);

        let backup_path = source_path.with_file_name(format!("{}_orbitfile_backup", folder_name));
        let backup_path_str = backup_path.to_string_lossy().to_string();

        fs::rename(source_path, &backup_path).map_err(|e| {
            let _ = fs::remove_dir_all(&target_path);
            format!("无法备份原目录: {}。请确保没有程序正在使用该目录。", e)
        })?;

        // 步骤 5: 创建目录联接
        match symlink_dir(&target_path, source_path) {
            Ok(_) => {
                // 步骤 6: 清理备份
                emit_progress(app_handle, 97.0, "linking", "正在清理临时文件...", source_size, source_size);

                if let Err(e) = fs::remove_dir_all(&backup_path) {
                    log_warn!("migration", "无法删除备份目录 {}: {}", backup_path_str, e);
                }

                // 步骤 7: 写入迁移历史
                if let Err(e) = crate::storage::history::add_migration_record(
                    &app_name,
                    &source,
                    &target_path_str,
                    source_size,
                    MigrationRecordType::App,
                ) {
                    log_warn!("migration", "保存迁移记录失败: {}", e);
                }

                emit_progress(app_handle, 100.0, "done", "迁移完成", source_size, source_size);

                Ok(MigrationResult {
                    success: true,
                    message: format!("迁移成功！应用已从 {} 迁移到 {}", source, target_path_str),
                    new_path: Some(target_path_str),
                })
            }
            Err(e) => {
                // 回滚：恢复原目录并清理目标
                if let Err(restore_err) = fs::rename(&backup_path, source_path) {
                    return Ok(MigrationResult {
                        success: false,
                        message: format!(
                            "严重错误: 创建链接失败 ({})，且无法恢复原目录 ({})。\n备份位置: {}\n目标位置: {}",
                            e, restore_err, backup_path_str, target_path_str
                        ),
                        new_path: None,
                    });
                }

                let _ = fs::remove_dir_all(&target_path);
                Ok(MigrationResult {
                    success: false,
                    message: format!(
                        "创建目录链接失败: {}。\n可能原因: 需要管理员权限或启用开发者模式。\n已自动恢复原目录。",
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
