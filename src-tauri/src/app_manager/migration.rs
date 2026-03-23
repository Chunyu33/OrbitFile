// 应用迁移模块
// 负责应用目录迁移、空间校验、回滚与历史写入

use std::fs;
use std::path::Path;

use fs_extra::dir::{copy, get_size, CopyOptions};
use sysinfo::Disks;

use crate::{MigrationRecordType, MigrationResult};

#[cfg(windows)]
use std::os::windows::fs::symlink_dir;

/// 获取指定磁盘的可用空间
/// 根据目标路径匹配对应磁盘，返回可用字节数
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

/// 核心迁移命令
/// 将应用从源路径迁移到目标路径，并创建 Windows 目录联接（Junction）
pub fn migrate_app(app_name: String, source: String, target_parent: String) -> Result<MigrationResult, String> {
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
        let source_size = get_size(source_path).map_err(|e| format!("无法计算源文件夹大小: {}", e))?;
        let available_space = get_available_space(target_parent_path);
        let required_space = (source_size as f64 * 1.1) as u64;

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

        // 步骤 2: 复制
        let mut options = CopyOptions::new();
        options.overwrite = false;
        options.copy_inside = true;
        copy(source_path, target_parent_path, &options).map_err(|e| format!("复制文件失败: {}", e))?;

        // 步骤 3: 完整性校验
        let target_size = get_size(&target_path).map_err(|e| format!("无法计算目标文件夹大小: {}", e))?;
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
                if let Err(e) = fs::remove_dir_all(&backup_path) {
                    eprintln!("警告: 无法删除备份目录 {}: {}", backup_path_str, e);
                }

                // 步骤 7: 写入迁移历史
                if let Err(e) = crate::add_migration_record(
                    &app_name,
                    &source,
                    &target_path_str,
                    source_size,
                    MigrationRecordType::App,
                ) {
                    eprintln!("警告: 保存迁移记录失败: {}", e);
                }

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
