// 大文件夹发现与管理模块
//
// 负责系统文件夹、应用数据文件夹和自定义文件夹的扫描、
// 迁移和恢复，以及应用数据模板的管理

use std::path::PathBuf;
use std::fs;
#[cfg(windows)]
use std::os::windows::fs::symlink_dir;
use fs_extra::dir::{move_dir, CopyOptions};

use tauri::{AppHandle, Emitter};

use crate::models::*;
use crate::utils;
use crate::storage::data_dir;
use crate::storage::data_dir::ensure_data_dir;

// ============================================================================
// 应用数据模板管理
// ============================================================================

/// 默认内置模板列表（与旧版硬编码一致，确保向后兼容）
pub fn default_app_data_templates() -> Vec<AppDataTemplate> {
    vec![
        AppDataTemplate {
            id: "wechat".to_string(), display_name: "微信".to_string(),
            icon_id: "wechat".to_string(),
            process_names: vec!["WeChat.exe".to_string()], path: None,
        },
        AppDataTemplate {
            id: "wxwork".to_string(), display_name: "企业微信".to_string(),
            icon_id: "wxwork".to_string(),
            process_names: vec!["WXWork.exe".to_string()], path: None,
        },
        AppDataTemplate {
            id: "qq".to_string(), display_name: "QQ".to_string(),
            icon_id: "qq".to_string(),
            process_names: vec!["QQ.exe".to_string()], path: None,
        },
        AppDataTemplate {
            id: "dingtalk".to_string(), display_name: "钉钉".to_string(),
            icon_id: "dingtalk".to_string(),
            process_names: vec!["DingTalk.exe".to_string()], path: None,
        },
        AppDataTemplate {
            id: "feishu".to_string(), display_name: "飞书".to_string(),
            icon_id: "feishu".to_string(),
            process_names: vec!["Lark.exe".to_string(), "Feishu.exe".to_string()], path: None,
        },
        AppDataTemplate {
            id: "chrome_cache".to_string(), display_name: "Chrome 缓存".to_string(),
            icon_id: "chrome_cache".to_string(),
            process_names: vec!["chrome.exe".to_string()], path: None,
        },
        AppDataTemplate {
            id: "edge_cache".to_string(), display_name: "Edge 缓存".to_string(),
            icon_id: "edge_cache".to_string(),
            process_names: vec!["msedge.exe".to_string()], path: None,
        },
        AppDataTemplate {
            id: "vscode_extensions".to_string(), display_name: "VS Code 扩展".to_string(),
            icon_id: "vscode_extensions".to_string(),
            process_names: vec!["code.exe".to_string()], path: None,
        },
        AppDataTemplate {
            id: "npm_global".to_string(), display_name: "npm 全局包".to_string(),
            icon_id: "npm_global".to_string(),
            process_names: vec![], path: None,
        },
    ]
}

/// 获取应用数据模板（Tauri 命令，供设置页展示和编辑）
#[tauri::command]
pub fn get_app_data_templates() -> Result<Vec<AppDataTemplate>, String> {
    Ok(load_app_data_templates())
}

/// 加载应用数据模板（文件不存在时自动创建默认模板）
pub fn load_app_data_templates() -> Vec<AppDataTemplate> {
    let path = utils::app_data_templates_path(&ensure_data_dir());
    if !path.exists() {
        let defaults = default_app_data_templates();
        let json = serde_json::to_string_pretty(&defaults).unwrap_or_default();
        let _ = std::fs::write(&path, &json);
        return defaults;
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<AppDataTemplate>>(&s).ok())
        .unwrap_or_else(default_app_data_templates)
}

/// 保存应用数据模板
#[tauri::command]
pub fn save_app_data_templates(templates: Vec<AppDataTemplate>) -> Result<(), String> {
    let path = utils::app_data_templates_path(&ensure_data_dir());
    let json = serde_json::to_string_pretty(&templates)
        .map_err(|e| format!("序列化模板失败: {}", e))?;
    std::fs::write(&path, &json)
        .map_err(|e| format!("写入模板文件失败: {}", e))?;
    Ok(())
}

// ============================================================================
// 大文件夹列表
// ============================================================================

/// 获取大文件夹列表
///
/// # 路径定位说明
///
/// ## 系统文件夹
/// 使用 `dirs` crate 获取 Windows 已知文件夹路径（Desktop/Documents/Downloads/Pictures/Videos）
///
/// ## 应用数据文件夹
/// 从 `app_data_templates.json` 加载模板，内置类型通过 detector 模块动态检测路径
#[tauri::command]
pub fn get_large_folders(app_handle: AppHandle) -> Result<Vec<LargeFolder>, String> {
    let mut folders: Vec<LargeFolder> = Vec::new();

    // ========== 系统文件夹 ==========
    let system_folders: Vec<(&str, &str, fn() -> Option<PathBuf>, Vec<&str>)> = vec![
        ("desktop", "桌面", dirs::desktop_dir as fn() -> Option<PathBuf>, vec!["explorer.exe"]),
        ("documents", "文档", dirs::document_dir as fn() -> Option<PathBuf>, vec![]),
        ("downloads", "下载", dirs::download_dir as fn() -> Option<PathBuf>, vec![]),
        ("pictures", "图片", dirs::picture_dir as fn() -> Option<PathBuf>, vec![]),
        ("videos", "视频", dirs::video_dir as fn() -> Option<PathBuf>, vec![]),
    ];

    for (id, name, getter, processes) in system_folders {
        if let Some(dir) = getter() {
            let path_str = dir.to_string_lossy().to_string();
            let is_junc = utils::is_junction(&dir);
            folders.push(LargeFolder {
                id: id.to_string(),
                display_name: name.to_string(),
                path: path_str.clone(),
                size: 0,
                folder_type: LargeFolderType::System,
                is_junction: is_junc,
                junction_target: if is_junc { utils::get_junction_target(&dir) } else { None },
                app_process_names: processes.iter().map(|s| s.to_string()).collect(),
                icon_id: id.to_string(),
                exists: dir.exists(),
            });
        }
    }

    // ========== 应用数据文件夹 ==========
    let app_data_templates = load_app_data_templates();

    let builtin_ids: Vec<String> = app_data_templates.iter()
        .filter(|t| t.path.is_none())
        .map(|t| t.id.clone())
        .collect();

    let all_statuses = crate::app_manager::detector::get_special_folders_status()?;

    for template in &app_data_templates {
        if let Some(custom_path) = &template.path {
            let expanded = utils::expand_env_vars(custom_path);
            let path = PathBuf::from(&expanded);
            let exists = path.exists() && path.is_dir();
            let is_junc = if exists { utils::is_junction(&path) } else { false };
            folders.push(LargeFolder {
                id: template.id.clone(),
                display_name: template.display_name.clone(),
                path: expanded, size: 0,
                folder_type: LargeFolderType::AppData,
                is_junction: is_junc,
                junction_target: if is_junc { utils::get_junction_target(&path) } else { None },
                app_process_names: template.process_names.clone(),
                icon_id: template.icon_id.clone(),
                exists,
            });
        } else if builtin_ids.contains(&template.id) {
            let status = match all_statuses.iter().find(|s| s.name == template.id) {
                Some(s) => s, None => continue,
            };
            let path = PathBuf::from(&status.current_path);
            let exists = status.is_detected;
            let is_junc = if exists { utils::is_junction(&path) } else { false };
            folders.push(LargeFolder {
                id: status.name.clone(),
                display_name: template.display_name.clone(),
                path: status.current_path.clone(), size: 0,
                folder_type: LargeFolderType::AppData,
                is_junction: is_junc,
                junction_target: if is_junc { utils::get_junction_target(&path) } else { None },
                app_process_names: template.process_names.clone(),
                icon_id: template.icon_id.clone(),
                exists,
            });
        }
    }

    // ========== 自定义文件夹 ==========
    let custom = data_dir::load_custom_folders(&utils::custom_folders_path(&ensure_data_dir()));
    for cf in &custom {
        let path = PathBuf::from(&cf.path);
        let exists = path.exists();
        let is_junc = if exists { utils::is_junction(&path) } else { false };
        folders.push(LargeFolder {
            id: cf.id.clone(), display_name: cf.display_name.clone(),
            path: cf.path.clone(), size: 0,
            folder_type: LargeFolderType::Custom,
            is_junction: is_junc,
            junction_target: if is_junc { utils::get_junction_target(&path) } else { None },
            app_process_names: vec![], icon_id: "folder".to_string(), exists,
        });
    }

    // 排序：按类型分组（系统 > 应用数据 > 自定义），已迁移的排后
    folders.sort_by(|a, b| {
        if a.is_junction && !b.is_junction { return std::cmp::Ordering::Greater; }
        if !a.is_junction && b.is_junction { return std::cmp::Ordering::Less; }
        let type_order = |t: &LargeFolderType| match t {
            LargeFolderType::System => 0, LargeFolderType::AppData => 1, LargeFolderType::Custom => 2,
        };
        type_order(&a.folder_type).cmp(&type_order(&b.folder_type))
    });

    // 后台异步计算文件夹大小
    compute_folder_sizes_async(app_handle.clone(), folders.clone());

    Ok(folders)
}

/// 后台异步计算各文件夹大小并通过事件推送
fn compute_folder_sizes_async(app_handle: AppHandle, folders: Vec<LargeFolder>) {
    std::thread::spawn(move || {
        for folder in &folders {
            if !folder.exists || folder.is_junction { continue; }
            let path = PathBuf::from(&folder.path);
            let size = utils::get_folder_size(&path);
            if size > 0 {
                let _ = app_handle.emit("large-folder-size", LargeFolderSizeEvent {
                    folder_id: folder.id.clone(), size,
                });
            }
        }
    });
}

// ============================================================================
// 大文件夹迁移与恢复
// ============================================================================

/// 迁移大文件夹（在后台线程执行，通过事件通知前端结果）
#[tauri::command]
pub fn migrate_large_folder(
    source_path: String,
    target_dir: String,
    state: tauri::State<'_, MigrationState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() { return Err(format!("源路径不存在: {}", source_path)); }
    if !source.is_dir() { return Err("源路径必须是一个目录".to_string()); }

    let folder_name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    state.cancel_flag.store(false, std::sync::atomic::Ordering::SeqCst);
    let cancel_flag = state.cancel_flag.clone();
    let handle = app_handle.clone();

    std::thread::spawn(move || {
        let result = crate::app_manager::migration::migrate_app(
            folder_name, source_path, target_dir, &cancel_flag, &handle,
        );
        let event = match result {
            Ok(r) => LargeFolderMigrationCompleteEvent {
                success: r.success, message: r.message, new_path: r.new_path,
            },
            Err(e) => LargeFolderMigrationCompleteEvent {
                success: false, message: e, new_path: None,
            },
        };
        let _ = handle.emit("large-folder-migration-complete", event);
    });

    Ok(())
}

/// 添加自定义文件夹
#[tauri::command]
pub fn add_custom_folder(path: String) -> Result<(), String> {
    let folder_path = PathBuf::from(&path);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err(format!("路径不存在或不是文件夹: {}", path));
    }

    let display_name = folder_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    // 基于路径生成唯一 ID（简单哈希）
    let hash: u64 = path.as_bytes().iter().enumerate()
        .fold(0u64, |acc, (i, &b)| acc.wrapping_add((b as u64).wrapping_mul(i as u64 + 1)));
    let id = format!("custom_{:x}", hash);

    let storage_path = utils::custom_folders_path(&ensure_data_dir());
    let mut custom = data_dir::load_custom_folders(&storage_path);
    if custom.iter().any(|c| c.path.to_lowercase() == path.to_lowercase()) {
        return Err("该文件夹已在列表中".to_string());
    }

    custom.push(CustomFolderEntry { id, path, display_name });
    data_dir::save_custom_folders(&storage_path, &custom)
}

/// 删除自定义文件夹
#[tauri::command]
pub fn remove_custom_folder(id: String) -> Result<(), String> {
    let storage_path = utils::custom_folders_path(&ensure_data_dir());
    let mut custom = data_dir::load_custom_folders(&storage_path);
    let before = custom.len();
    custom.retain(|c| c.id != id);
    if custom.len() == before {
        return Err("未找到该自定义文件夹".to_string());
    }
    data_dir::save_custom_folders(&storage_path, &custom)
}

/// 恢复大文件夹（从 Junction 恢复到原位置）
#[tauri::command]
pub fn restore_large_folder(
    junction_path: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let junction = PathBuf::from(&junction_path);

        if !utils::is_junction(&junction) {
            return Err("该路径不是一个符号链接，无法恢复".to_string());
        }

        let target_path = match utils::get_junction_target(&junction) {
            Some(target) => PathBuf::from(target),
            None => return Err("无法读取符号链接的目标路径".to_string()),
        };

        if !target_path.exists() {
            return Err(format!("目标路径不存在: {}", target_path.to_string_lossy()));
        }

        let handle = app_handle.clone();
        let target_path_str = target_path.to_string_lossy().to_string();
        std::thread::spawn(move || {
            let result = restore_large_folder_inner(&junction, &target_path_str);
            let event = match &result {
                Ok(r) => LargeFolderRestoreCompleteEvent {
                    success: r.success, message: r.message.clone(), new_path: r.new_path.clone(),
                },
                Err(e) => LargeFolderRestoreCompleteEvent {
                    success: false, message: e.clone(), new_path: None,
                },
            };
            let _ = handle.emit("large-folder-restore-complete", event);
        });

        Ok(())
    }

    #[cfg(not(windows))]
    { Err("此功能仅支持 Windows 系统".to_string()) }
}

/// 恢复大文件夹的内部逻辑（在后台线程中执行）
fn restore_large_folder_inner(
    junction_path: &std::path::Path,
    target_str: &str,
) -> Result<MigrationResult, String> {
    let target_path = PathBuf::from(target_str);

    // 步骤 1: 还原前检查目标盘空间
    let file_size = fs_extra::dir::get_size(&target_path).unwrap_or(0);
    let original_parent = junction_path.parent()
        .ok_or("无法获取原路径的父目录")?;
    utils::check_disk_space_for_restore(original_parent, file_size)?;

    // 步骤 2: 删除 Junction
    fs::remove_dir(junction_path).map_err(|e| {
        format!("无法删除符号链接: {}", e)
    })?;

    // 步骤 3: 移动文件夹回原位置
    let mut options = CopyOptions::new();
    options.overwrite = false;
    options.copy_inside = false;

    move_dir(&target_path, original_parent, &options).map_err(|e| {
        #[cfg(windows)]
        let _ = symlink_dir(&target_path, junction_path);
        format!("移动文件夹失败: {}。已恢复符号链接。", e)
    })?;

    // 步骤 4: 更新迁移记录状态
    let junction_str = junction_path.to_string_lossy().to_string();
    if let Err(e) = crate::storage::history::update_migration_record_status(&junction_str, "restored") {
        eprintln!("警告: 更新迁移记录状态失败: {}", e);
    }

    Ok(MigrationResult {
        success: true,
        message: format!("恢复成功！文件夹已恢复到 {}", junction_str),
        new_path: Some(junction_str),
    })
}
