// OrbitFile — 专业的 Windows 存储重定向工具
//
// 模块结构：
// - models:           共享数据结构（跨模块基础类型）
// - utils:            文件系统工具函数
// - system/           系统接口（磁盘信息、图标提取）
// - storage/          存储层（数据目录配置、迁移历史持久化）
// - folder_manager/   文件夹管理（发现、迁移、恢复大文件夹）
// - app_manager/      应用管理（扫描、迁移、卸载、检测）

mod app_manager;
mod models;
mod utils;
mod system;
mod storage;
mod folder_manager;

use std::sync::atomic::Ordering;

use crate::models::*;
use crate::app_manager::uninstaller;

// ============================================================================
// Tauri 命令 — 应用管理（委托给 app_manager 子模块）
// ============================================================================

#[tauri::command]
fn get_installed_apps() -> Result<Vec<InstalledApp>, String> {
    app_manager::scanner::get_installed_apps()
}

#[tauri::command]
fn get_app_size(install_location: String) -> Result<u64, String> {
    app_manager::scanner::get_app_size(install_location)
}

#[tauri::command]
fn check_process_locks(source_path: String) -> Result<ProcessLockResult, String> {
    app_manager::scanner::check_process_locks(source_path)
}

#[tauri::command]
fn migrate_app(
    app_name: String,
    source: String,
    target_parent: String,
    state: tauri::State<'_, MigrationState>,
    app_handle: tauri::AppHandle,
) -> Result<MigrationResult, String> {
    state.cancel_flag.store(false, Ordering::SeqCst);
    app_manager::migration::migrate_app(
        app_name, source, target_parent, &state.cancel_flag, &app_handle,
    )
}

#[tauri::command]
fn migrate_special_folder(
    app_name: String,
    source_path: String,
    target_dir: String,
    state: tauri::State<'_, MigrationState>,
    app_handle: tauri::AppHandle,
) -> Result<MigrationResult, String> {
    state.cancel_flag.store(false, Ordering::SeqCst);
    app_manager::detector::migrate_special_folder(
        app_name, source_path, target_dir, &state.cancel_flag, &app_handle,
    )
}

#[tauri::command]
fn cancel_migration(state: tauri::State<'_, MigrationState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

// ============================================================================
// Tauri 命令 — 卸载（委托给 app_manager::uninstaller）
// ============================================================================

#[tauri::command]
fn preview_uninstall(input: uninstaller::UninstallInput) -> Result<uninstaller::UninstallPreview, String> {
    uninstaller::preview_uninstall(input)
}

#[tauri::command]
fn force_remove_application(input: uninstaller::UninstallInput) -> Result<uninstaller::UninstallResult, String> {
    uninstaller::force_remove_application(input)
}

#[tauri::command]
async fn uninstall_application(input: uninstaller::UninstallInput) -> Result<uninstaller::UninstallResult, String> {
    uninstaller::uninstall_application(input).await
}

#[tauri::command]
fn scan_app_residue(
    app_name: String, publisher: Option<String>, install_location: Option<String>,
) -> Result<Vec<uninstaller::LeftoverItem>, String> {
    uninstaller::scan_app_residue(app_name, publisher, install_location)
}

#[tauri::command]
fn execute_cleanup(
    items: Vec<String>, app_name: Option<String>, publisher: Option<String>,
) -> Result<uninstaller::CleanupResult, String> {
    uninstaller::execute_cleanup(items, app_name, publisher)
}

// ============================================================================
// Tauri 应用入口
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(MigrationState::default())
        .invoke_handler(tauri::generate_handler![
            // 系统接口
            system::disk_usage::get_disk_usage,
            // 存储层 — 数据目录
            storage::data_dir::get_data_dir_info,
            storage::data_dir::set_data_dir,
            // 文件夹管理
            folder_manager::get_large_folders,
            folder_manager::migrate_large_folder,
            folder_manager::add_custom_folder,
            folder_manager::remove_custom_folder,
            folder_manager::restore_large_folder,
            folder_manager::get_app_data_templates,
            folder_manager::save_app_data_templates,
            // 存储层 — 历史记录
            storage::history::get_migration_history,
            storage::history::get_migrated_paths,
            storage::history::restore_app,
            storage::history::check_link_status,
            storage::history::clean_ghost_links,
            storage::history::preview_ghost_links,
            storage::history::get_migration_stats,
            storage::history::export_history,
            storage::history::import_history,
            storage::history::open_data_dir,
            storage::history::open_folder,
            // 存储层 — 操作日志
            storage::operation_log::get_operation_logs,
            // 应用管理
            get_installed_apps,
            get_app_size,
            check_process_locks,
            migrate_app,
            migrate_special_folder,
            cancel_migration,
            // 卸载
            preview_uninstall,
            force_remove_application,
            uninstall_application,
            scan_app_residue,
            execute_cleanup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
