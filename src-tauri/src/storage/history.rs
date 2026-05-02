// 迁移历史记录持久化模块
//
// 持久化方案：JSON 文件存储，位于 %APPDATA%/orbit-file/migration_history.json
// 选择 JSON 而非 SQLite 的原因：
// 1. 轻量级 — 无需额外依赖
// 2. 可读性 — 用户可直接查看/编辑
// 3. 简单可靠 — 迁移历史是低频写入场景，JSON 足够

use std::path::{Path, PathBuf};
use std::fs;
use std::io::{Read, Write};
#[cfg(windows)]
use std::os::windows::fs::symlink_dir;
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashSet;

use fs_extra::dir::{move_dir, CopyOptions};

use crate::models::*;
use crate::utils;
use super::data_dir::ensure_data_dir;

/// 获取历史记录文件路径
pub fn get_history_file_path() -> PathBuf {
    utils::history_file_path(&ensure_data_dir())
}

/// 从 JSON 文件加载历史记录
pub fn load_history() -> HistoryStorage {
    let path = get_history_file_path();

    if !path.exists() {
        return HistoryStorage { version: 1, records: Vec::new() };
    }

    let mut file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return HistoryStorage { version: 1, records: Vec::new() },
    };

    let mut contents = String::new();
    if file.read_to_string(&mut contents).is_err() {
        return HistoryStorage { version: 1, records: Vec::new() };
    }

    serde_json::from_str(&contents).unwrap_or(HistoryStorage { version: 1, records: Vec::new() })
}

/// 原子写入历史记录
///
/// 策略：先写临时文件 → sync 刷盘 → 备份旧文件 → rename 覆盖
/// 确保写入过程中崩溃不会损坏原有数据
pub fn save_history(storage: &HistoryStorage) -> Result<(), String> {
    let path = get_history_file_path();
    let temp_path = path.with_extension("json.tmp");
    let backup_path = path.with_extension("json.bak");

    let json = serde_json::to_string_pretty(storage)
        .map_err(|e| format!("序列化历史记录失败: {}", e))?;

    // 1. 写入临时文件并刷盘
    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("创建临时文件失败: {}", e))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("写入临时文件失败: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("同步临时文件失败: {}", e))?;

    // 2. 备份旧文件（失败不阻塞）
    if path.exists() {
        let _ = fs::copy(&path, &backup_path);
    }

    // 3. 原子替换
    fs::rename(&temp_path, &path)
        .map_err(|e| format!("重命名历史文件失败: {}", e))?;

    Ok(())
}

/// 添加一条迁移记录，返回记录 ID
pub fn add_migration_record(
    app_name: &str,
    original_path: &str,
    target_path: &str,
    size: u64,
    record_type: MigrationRecordType,
) -> Result<String, String> {
    let mut storage = load_history();

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let id = format!("mig_{}", timestamp);

    storage.records.push(MigrationRecord {
        id: id.clone(),
        app_name: app_name.to_string(),
        original_path: original_path.to_string(),
        target_path: target_path.to_string(),
        size,
        migrated_at: timestamp,
        status: "active".to_string(),
        record_type,
    });

    save_history(&storage)?;
    Ok(id)
}

/// 更新迁移记录状态（按 original_path 大小写不敏感匹配）
pub fn update_migration_record_status(original_path: &str, new_status: &str) -> Result<(), String> {
    let mut storage = load_history();

    let found = storage.records.iter_mut().any(|record| {
        if record.original_path.eq_ignore_ascii_case(original_path) && record.status == "active" {
            record.status = new_status.to_string();
            true
        } else {
            false
        }
    });

    if !found {
        return Err(format!("未找到路径 {} 的迁移记录", original_path));
    }

    save_history(&storage)
}

// ============================================================================
// 查询命令
// ============================================================================

/// 获取活跃的迁移记录
#[tauri::command]
pub fn get_migration_history() -> Result<Vec<MigrationRecord>, String> {
    let storage = load_history();
    Ok(storage.records.into_iter().filter(|r| r.status == "active").collect())
}

/// 获取所有已迁移应用的原始路径列表
#[tauri::command]
pub fn get_migrated_paths() -> Result<Vec<String>, String> {
    let storage = load_history();
    Ok(storage.records.iter()
        .filter(|r| r.status == "active")
        .map(|r| r.original_path.clone())
        .collect())
}

/// 检查迁移记录的链接健康状态
#[tauri::command]
pub fn check_link_status(record_id: String) -> Result<LinkStatusResult, String> {
    let storage = load_history();

    let record = match storage.records.iter().find(|r| r.id == record_id && r.status == "active") {
        Some(r) => r,
        None => return Ok(LinkStatusResult {
            healthy: false, target_exists: false, is_junction: false,
            error: Some("未找到该迁移记录".to_string()),
        }),
    };

    let original_path = Path::new(&record.original_path);
    let target_path = Path::new(&record.target_path);
    let is_junc = utils::is_junction(original_path);
    let target_exists = target_path.exists();

    Ok(LinkStatusResult {
        healthy: is_junc && target_exists,
        target_exists, is_junction: is_junc, error: None,
    })
}

// ============================================================================
// 幽灵链接管理
// ============================================================================

/// 预览幽灵链接（只读扫描，不执行删除）
#[tauri::command]
pub fn preview_ghost_links() -> Result<GhostLinkPreview, String> {
    let storage = load_history();
    let mut entries = Vec::new();
    let mut total_size: u64 = 0;

    for record in &storage.records {
        if record.status != "active" { continue; }
        let target_path = Path::new(&record.target_path);
        if !target_path.exists() {
            entries.push(GhostLinkEntry {
                record_id: record.id.clone(),
                app_name: record.app_name.clone(),
                original_path: record.original_path.clone(),
                target_path: record.target_path.clone(),
                size: record.size,
            });
            total_size += record.size;
        }
    }

    Ok(GhostLinkPreview { entries, total_size })
}

/// 清理幽灵链接
#[tauri::command]
pub fn clean_ghost_links() -> Result<CleanupResult, String> {
    let mut storage = load_history();
    let mut cleaned_count = 0u32;
    let mut cleaned_size: u64 = 0;
    let mut errors: Vec<String> = Vec::new();

    for record in storage.records.iter_mut() {
        if record.status != "active" { continue; }

        let original_path = Path::new(&record.original_path);
        let target_path = Path::new(&record.target_path);

        if !target_path.exists() {
            // 尝试删除 Junction
            if original_path.exists() && utils::is_junction(original_path) {
                if let Err(e) = fs::remove_dir(original_path) {
                    errors.push(format!("无法删除 Junction {}: {}", record.original_path, e));
                    continue;
                }
            }

            record.status = "ghost_cleaned".to_string();
            cleaned_count += 1;
            cleaned_size += record.size;
        }
    }

    if cleaned_count > 0 {
        save_history(&storage)?;
    }

    Ok(CleanupResult { cleaned_count, cleaned_size, errors })
}

// ============================================================================
// 统计信息
// ============================================================================

/// 获取迁移统计信息
#[tauri::command]
pub fn get_migration_stats() -> Result<MigrationStats, String> {
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
                if record.record_type == MigrationRecordType::LargeFolder {
                    folder_count += 1;
                } else {
                    app_count += 1;
                }
            }
            "restored" => { restored_count += 1; }
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

// ============================================================================
// 导入导出
// ============================================================================

/// 导出迁移历史记录到指定路径
#[tauri::command]
pub fn export_history(dest_path: String) -> Result<(), String> {
    let src = get_history_file_path();
    if !src.exists() {
        return Err("历史记录文件不存在，请先执行迁移操作".to_string());
    }
    fs::copy(&src, &dest_path).map_err(|e| format!("导出失败: {}", e))?;
    Ok(())
}

/// 从指定路径导入并合并迁移历史记录（按 id 去重）
#[tauri::command]
pub fn import_history(src_path: String) -> Result<u32, String> {
    let import_path = Path::new(&src_path);
    if !import_path.exists() { return Err("导入文件不存在".to_string()); }

    let contents = fs::read_to_string(import_path)
        .map_err(|e| format!("读取导入文件失败: {}", e))?;

    let imported: HistoryStorage = serde_json::from_str(&contents)
        .map_err(|e| format!("导入文件格式无效: {}", e))?;

    let mut current = load_history();
    let existing_ids: HashSet<String> = current.records.iter().map(|r| r.id.clone()).collect();

    let mut added: u32 = 0;
    for record in imported.records {
        if !existing_ids.contains(&record.id) {
            current.records.push(record);
            added += 1;
        }
    }

    if added > 0 { save_history(&current)?; }
    Ok(added)
}

// ============================================================================
// 应用还原
// ============================================================================

/// 恢复已迁移应用到原始位置
///
/// # 恢复流程
/// 1. 查找迁移记录
/// 2. 验证状态（目标存在、原路径为 Junction）
/// 3. 空间检查（必须在删除 Junction 前执行）
/// 4. 删除 Junction
/// 5. 移动文件回原位置（失败时回滚重建 Junction）
/// 6. 更新记录状态
#[tauri::command]
pub fn restore_app(history_id: String) -> Result<MigrationResult, String> {
    #[cfg(windows)]
    {
        // 步骤 1: 查找记录
        let mut storage = load_history();

        let record_index = match storage.records.iter().position(|r| r.id == history_id && r.status == "active") {
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

        // 步骤 2: 验证状态
        if !target_path.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("目标路径不存在: {}，可能已被手动删除", record.target_path),
                new_path: None,
            });
        }

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

        // 步骤 3: 还原前空间检查
        let file_size = fs_extra::dir::get_size(&target_path).unwrap_or(record.size);
        let original_parent = original_path.parent()
            .ok_or("无法获取原路径的父目录")?;
        utils::check_disk_space_for_restore(original_parent, file_size)?;

        // 步骤 4: 删除 Junction
        if original_path.exists() {
            fs::remove_dir(&original_path).map_err(|e| {
                format!("删除符号链接失败: {}。请确保没有程序正在使用该目录。", e)
            })?;
        }

        // 步骤 5: 移动文件回原位置（失败时回滚）
        let mut options = CopyOptions::new();
        options.overwrite = false;
        options.copy_inside = false;

        move_dir(&target_path, original_parent, &options).map_err(|e| {
            let _ = symlink_dir(&target_path, &original_path);
            format!("移动文件失败: {}。已恢复符号链接。", e)
        })?;

        // 步骤 6: 更新记录
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

// ============================================================================
// 工具命令
// ============================================================================

/// 在文件资源管理器中打开数据目录
#[tauri::command]
pub fn open_data_dir() -> Result<(), String> {
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

/// 在资源管理器中打开指定文件夹
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let path_obj = Path::new(&path);
        if !path_obj.exists() {
            return Err(format!("路径不存在: {}", path));
        }

        let result = if path_obj.is_dir() {
            std::process::Command::new("explorer").arg(&path).spawn()
        } else {
            std::process::Command::new("explorer")
                .arg("/select,").arg(&path).spawn()
        };

        result.map(|_| ()).map_err(|e| format!("打开文件夹失败: {}", e))
    }

    #[cfg(not(windows))]
    { Err("此功能仅支持 Windows 系统".to_string()) }
}
