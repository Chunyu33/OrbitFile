// OrbitFile - 专业的 Windows 存储重定向工具
// 后端 Rust 模块，提供系统扫描、磁盘信息、应用迁移和历史记录功能

use serde::{Deserialize, Serialize};
use sysinfo::{Disks, System};
use std::path::{Path, PathBuf};
use std::fs;
use std::io::{Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};

// 仅在 Windows 平台编译 winreg 和 symlink 相关代码
#[cfg(windows)]
use winreg::enums::*;
#[cfg(windows)]
use winreg::RegKey;
#[cfg(windows)]
use std::os::windows::fs::symlink_dir;

// fs_extra 用于递归复制文件夹和移动文件夹
use fs_extra::dir::{copy, move_dir, CopyOptions, get_size};

/// 已安装应用信息结构体
/// 包含从 Windows 注册表读取的应用基本信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstalledApp {
    /// 应用显示名称
    pub display_name: String,
    /// 安装位置路径
    pub install_location: String,
    /// 应用图标路径
    pub display_icon: String,
    /// 预估大小（KB）
    pub estimated_size: u64,
}

/// 磁盘使用信息结构体
/// 包含 C 盘的总容量和可用空间
#[derive(Debug, Serialize, Deserialize)]
pub struct DiskUsage {
    /// 总容量（字节）
    pub total_space: u64,
    /// 可用空间（字节）
    pub free_space: u64,
    /// 已使用空间（字节）
    pub used_space: u64,
    /// 使用百分比
    pub usage_percent: f64,
}

/// 获取已安装应用列表
/// 扫描 Windows 注册表中的 Uninstall 键，提取应用信息
#[tauri::command]
fn get_installed_apps() -> Result<Vec<InstalledApp>, String> {
    #[cfg(windows)]
    {
        let mut apps: Vec<InstalledApp> = Vec::new();
        
        // 定义需要扫描的注册表路径
        // 包括 64 位和 32 位应用的注册表位置
        let registry_paths = [
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ];

        for (hkey, path) in registry_paths.iter() {
            // 尝试打开注册表键
            if let Ok(uninstall_key) = RegKey::predef(*hkey).open_subkey(path) {
                // 遍历所有子键（每个子键代表一个已安装的应用）
                for subkey_name in uninstall_key.enum_keys().filter_map(|k| k.ok()) {
                    if let Ok(subkey) = uninstall_key.open_subkey(&subkey_name) {
                        // 读取应用显示名称，跳过没有名称的条目
                        let display_name: String = subkey.get_value("DisplayName").unwrap_or_default();
                        if display_name.is_empty() {
                            continue;
                        }

                        // 读取安装位置
                        // 注意：某些注册表条目的路径可能带有引号，需要去除
                        let raw_location: String = subkey.get_value("InstallLocation").unwrap_or_default();
                        let install_location = raw_location.trim().trim_matches('"').to_string();
                        
                        // 读取应用图标路径
                        let display_icon: String = subkey.get_value("DisplayIcon").unwrap_or_default();
                        
                        // 读取预估大小（注册表中以 KB 为单位存储）
                        let estimated_size: u64 = subkey.get_value::<u32, _>("EstimatedSize")
                            .unwrap_or(0) as u64;

                        // 只添加有安装位置的应用（便于后续迁移）
                        if !install_location.is_empty() {
                            // 检查是否已存在相同名称的应用（避免重复）
                            if !apps.iter().any(|app| app.display_name == display_name) {
                                apps.push(InstalledApp {
                                    display_name,
                                    install_location,
                                    display_icon,
                                    estimated_size,
                                });
                            }
                        }
                    }
                }
            }
        }

        // 按应用名称排序
        apps.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
        
        Ok(apps)
    }

    #[cfg(not(windows))]
    {
        // 非 Windows 平台返回空列表
        Ok(Vec::new())
    }
}

/// 获取 C 盘磁盘使用情况
/// 使用 sysinfo 库读取系统磁盘信息
#[tauri::command]
fn get_disk_usage() -> Result<DiskUsage, String> {
    // 创建磁盘信息实例
    let disks = Disks::new_with_refreshed_list();
    
    // 查找 C 盘（Windows 系统盘）
    for disk in disks.list() {
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        
        // 检查是否为 C 盘
        if mount_point.starts_with("C:") || mount_point == "/" {
            let total_space = disk.total_space();
            let free_space = disk.available_space();
            let used_space = total_space.saturating_sub(free_space);
            let usage_percent = if total_space > 0 {
                (used_space as f64 / total_space as f64) * 100.0
            } else {
                0.0
            };

            return Ok(DiskUsage {
                total_space,
                free_space,
                used_space,
                usage_percent,
            });
        }
    }

    // 如果没有找到 C 盘，返回第一个磁盘的信息
    if let Some(disk) = disks.list().first() {
        let total_space = disk.total_space();
        let free_space = disk.available_space();
        let used_space = total_space.saturating_sub(free_space);
        let usage_percent = if total_space > 0 {
            (used_space as f64 / total_space as f64) * 100.0
        } else {
            0.0
        };

        return Ok(DiskUsage {
            total_space,
            free_space,
            used_space,
            usage_percent,
        });
    }

    Err("无法获取磁盘信息".to_string())
}

// ============================================================================
// Phase 2: 核心迁移引擎
// ============================================================================

/// 迁移结果结构体
/// 用于向前端返回迁移操作的详细结果
#[derive(Debug, Serialize, Deserialize)]
pub struct MigrationResult {
    /// 是否成功
    pub success: bool,
    /// 结果消息
    pub message: String,
    /// 新的安装路径（成功时返回）
    pub new_path: Option<String>,
}

/// 进程锁检测结果
/// 返回占用源路径文件的进程列表
#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessLockResult {
    /// 是否有进程占用
    pub is_locked: bool,
    /// 占用进程名称列表
    pub processes: Vec<String>,
}

/// 检测指定路径是否被进程占用
/// 使用 sysinfo 扫描所有进程，检查其打开的文件是否在源路径下
/// 
/// # 参数
/// - `source_path`: 要检测的源文件夹路径
/// 
/// # 返回
/// - `ProcessLockResult`: 包含是否被锁定及占用进程列表
#[tauri::command]
fn check_process_locks(source_path: String) -> Result<ProcessLockResult, String> {
    let source = Path::new(&source_path);
    
    // 检查路径是否存在
    if !source.exists() {
        return Err(format!("源路径不存在: {}", source_path));
    }

    let mut sys = System::new_all();
    sys.refresh_all();

    let mut locked_processes: Vec<String> = Vec::new();
    let source_lower = source_path.to_lowercase();

    // 遍历所有进程，检查其可执行文件路径是否在源目录下
    // 注意：sysinfo 无法直接获取进程打开的所有文件句柄
    // 这里采用简化方案：检查进程的可执行文件是否位于源目录
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

/// 获取指定磁盘的可用空间
/// 
/// # 参数
/// - `path`: 目标路径（用于确定所在磁盘）
/// 
/// # 返回
/// - 可用空间（字节）
fn get_available_space(path: &Path) -> u64 {
    let disks = Disks::new_with_refreshed_list();
    
    // 获取路径的盘符（如 "D:"）
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
/// 
/// # 迁移流程详解
/// 
/// 1. **空间检查**: 计算源文件夹大小，确认目标磁盘有足够空间
/// 2. **创建临时目录**: 在目标路径下创建临时文件夹存放复制的文件
/// 3. **递归复制**: 使用 fs_extra 将所有文件从源路径复制到目标
/// 4. **完整性校验**: 比较源和目标文件夹的总大小是否一致
/// 5. **备份原目录**: 将原始源目录重命名为 xxx_backup
/// 6. **创建 Junction**: 在原路径创建指向新位置的目录联接
///    - Junction 是 Windows 特有的目录链接，对应用程序透明
///    - 应用仍然认为文件在原位置，但实际存储在新磁盘
/// 7. **清理备份**: 迁移成功后删除备份目录
/// 8. **回滚机制**: 任何步骤失败都会尝试恢复原状态
/// 
/// # 参数
/// - `app_name`: 应用名称（用于记录历史）
/// - `source`: 源路径（应用原安装位置）
/// - `target_parent`: 目标父目录（用户选择的目标文件夹）
/// 
/// # 返回
/// - `MigrationResult`: 迁移结果，包含成功状态和新路径
#[tauri::command]
fn migrate_app(app_name: String, source: String, target_parent: String) -> Result<MigrationResult, String> {
    #[cfg(windows)]
    {
        let source_path = Path::new(&source);
        let target_parent_path = Path::new(&target_parent);

        // ========== 步骤 0: 基础验证 ==========
        
        // 检查源路径是否存在
        if !source_path.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("源路径不存在: {}", source),
                new_path: None,
            });
        }

        // 检查源路径是否为目录
        if !source_path.is_dir() {
            return Ok(MigrationResult {
                success: false,
                message: "源路径必须是一个目录".to_string(),
                new_path: None,
            });
        }

        // 检查目标父目录是否存在
        if !target_parent_path.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("目标路径不存在: {}", target_parent),
                new_path: None,
            });
        }

        // 获取源文件夹名称
        let folder_name = source_path
            .file_name()
            .ok_or("无法获取源文件夹名称")?
            .to_string_lossy()
            .to_string();

        // 构建目标完整路径
        let target_path = target_parent_path.join(&folder_name);
        let target_path_str = target_path.to_string_lossy().to_string();

        // 检查目标路径是否已存在
        if target_path.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("目标路径已存在: {}", target_path_str),
                new_path: None,
            });
        }

        // ========== 步骤 1: 空间检查 ==========
        
        // 计算源文件夹大小
        let source_size = get_size(&source_path).map_err(|e| format!("无法计算源文件夹大小: {}", e))?;
        
        // 获取目标磁盘可用空间
        let available_space = get_available_space(&target_parent_path);
        
        // 预留 10% 额外空间作为安全边际
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

        // ========== 步骤 2: 复制文件 ==========
        
        // 配置复制选项
        let mut options = CopyOptions::new();
        options.overwrite = false;  // 不覆盖已存在的文件
        options.copy_inside = true; // 复制目录内容而非目录本身
        
        // 执行递归复制
        // fs_extra::dir::copy 会将 source 目录复制到 target_parent 下
        copy(&source_path, &target_parent_path, &options)
            .map_err(|e| format!("复制文件失败: {}", e))?;

        // ========== 步骤 3: 完整性校验 ==========
        
        // 计算目标文件夹大小
        let target_size = get_size(&target_path).map_err(|e| format!("无法计算目标文件夹大小: {}", e))?;
        
        // 允许 1% 的误差（文件系统元数据可能略有差异）
        let size_diff = (source_size as i64 - target_size as i64).abs();
        let tolerance = (source_size as f64 * 0.01) as i64;
        
        if size_diff > tolerance {
            // 校验失败，删除已复制的目标文件夹
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

        // ========== 步骤 4: 备份原目录 ==========
        
        let backup_path = source_path.with_file_name(format!("{}_orbitfile_backup", folder_name));
        let backup_path_str = backup_path.to_string_lossy().to_string();
        
        // 重命名原目录为备份
        fs::rename(&source_path, &backup_path).map_err(|e| {
            // 重命名失败，清理目标文件夹
            let _ = fs::remove_dir_all(&target_path);
            format!("无法备份原目录: {}。请确保没有程序正在使用该目录。", e)
        })?;

        // ========== 步骤 5: 创建 Junction（目录联接） ==========
        // 
        // Junction 是 Windows NTFS 文件系统的特性，类似于 Unix 的符号链接
        // 它允许一个目录路径指向另一个目录的实际位置
        // 对于应用程序来说，访问原路径和访问新路径是完全透明的
        // 
        // 使用 std::os::windows::fs::symlink_dir 创建目录符号链接
        // 注意：在 Windows 上创建符号链接可能需要管理员权限或开发者模式
        
        match symlink_dir(&target_path, &source_path) {
            Ok(_) => {
                // Junction 创建成功
                
                // ========== 步骤 6: 清理备份 ==========
                // 迁移完全成功，可以安全删除备份目录
                if let Err(e) = fs::remove_dir_all(&backup_path) {
                    // 删除备份失败不影响迁移结果，只记录警告
                    eprintln!("警告: 无法删除备份目录 {}: {}", backup_path_str, e);
                }

                // ========== 步骤 7: 保存迁移记录 ==========
                // 将迁移信息持久化到 JSON 文件，用于历史查看和恢复
                if let Err(e) = add_migration_record(&app_name, &source, &target_path_str, source_size) {
                    eprintln!("警告: 保存迁移记录失败: {}", e);
                }

                Ok(MigrationResult {
                    success: true,
                    message: format!("迁移成功！应用已从 {} 迁移到 {}", source, target_path_str),
                    new_path: Some(target_path_str),
                })
            }
            Err(e) => {
                // ========== 回滚机制 ==========
                // Junction 创建失败，需要恢复原状态
                
                // 尝试恢复原目录
                if let Err(restore_err) = fs::rename(&backup_path, &source_path) {
                    // 恢复也失败了，这是严重错误
                    return Ok(MigrationResult {
                        success: false,
                        message: format!(
                            "严重错误: 创建链接失败 ({})，且无法恢复原目录 ({})。\n备份位置: {}\n目标位置: {}",
                            e, restore_err, backup_path_str, target_path_str
                        ),
                        new_path: None,
                    });
                }

                // 删除已复制的目标文件夹
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

// ============================================================================
// Phase 3: 持久化存储 - 迁移历史记录
// ============================================================================
// 
// 持久化方案说明：
// 使用 JSON 文件存储迁移历史记录，存放在用户的 AppData 目录下
// 路径：%APPDATA%/orbit-file/migration_history.json
// 
// 选择 JSON 而非 SQLite 的原因：
// 1. 轻量级：无需额外依赖，减少包体积
// 2. 可读性：用户可直接查看/编辑历史记录
// 3. 简单可靠：迁移历史是低频写入场景，JSON 完全够用
// ============================================================================

/// 迁移历史记录结构体
/// 记录每次迁移的详细信息，用于历史查看和恢复操作
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MigrationRecord {
    /// 唯一标识符（使用时间戳生成）
    pub id: String,
    /// 应用名称
    pub app_name: String,
    /// 原始路径（迁移前的位置，现在是 Junction 链接）
    pub original_path: String,
    /// 目标路径（迁移后的实际存储位置）
    pub target_path: String,
    /// 迁移大小（字节）
    pub size: u64,
    /// 迁移时间（Unix 时间戳，毫秒）
    pub migrated_at: u64,
    /// 状态：active（已迁移）、restored（已恢复）
    pub status: String,
}

/// 历史记录存储结构
/// 包含版本号和记录列表，便于后续升级数据格式
#[derive(Debug, Serialize, Deserialize)]
struct HistoryStorage {
    /// 数据格式版本
    version: u32,
    /// 迁移记录列表
    records: Vec<MigrationRecord>,
}

/// 获取历史记录文件路径
/// 返回 %APPDATA%/orbit-file/migration_history.json
fn get_history_file_path() -> PathBuf {
    // 获取 AppData 目录
    let app_data = std::env::var("APPDATA")
        .unwrap_or_else(|_| ".".to_string());
    
    let dir = PathBuf::from(app_data).join("orbit-file");
    
    // 确保目录存在
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    
    dir.join("migration_history.json")
}

/// 读取历史记录
/// 从 JSON 文件加载所有迁移记录
fn load_history() -> HistoryStorage {
    let path = get_history_file_path();
    
    if !path.exists() {
        // 文件不存在，返回空记录
        return HistoryStorage {
            version: 1,
            records: Vec::new(),
        };
    }
    
    // 读取文件内容
    let mut file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return HistoryStorage { version: 1, records: Vec::new() },
    };
    
    let mut contents = String::new();
    if file.read_to_string(&mut contents).is_err() {
        return HistoryStorage { version: 1, records: Vec::new() };
    }
    
    // 解析 JSON
    serde_json::from_str(&contents).unwrap_or(HistoryStorage {
        version: 1,
        records: Vec::new(),
    })
}

/// 保存历史记录
/// 将记录列表写入 JSON 文件
fn save_history(storage: &HistoryStorage) -> Result<(), String> {
    let path = get_history_file_path();
    
    // 序列化为格式化的 JSON（便于人工查看）
    let json = serde_json::to_string_pretty(storage)
        .map_err(|e| format!("序列化历史记录失败: {}", e))?;
    
    // 写入文件
    let mut file = fs::File::create(&path)
        .map_err(|e| format!("创建历史文件失败: {}", e))?;
    
    file.write_all(json.as_bytes())
        .map_err(|e| format!("写入历史文件失败: {}", e))?;
    
    Ok(())
}

/// 添加迁移记录
/// 在迁移成功后调用，记录迁移信息
fn add_migration_record(
    app_name: &str,
    original_path: &str,
    target_path: &str,
    size: u64,
) -> Result<String, String> {
    let mut storage = load_history();
    
    // 生成唯一 ID（使用当前时间戳）
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    
    let id = format!("mig_{}", timestamp);
    
    let record = MigrationRecord {
        id: id.clone(),
        app_name: app_name.to_string(),
        original_path: original_path.to_string(),
        target_path: target_path.to_string(),
        size,
        migrated_at: timestamp,
        status: "active".to_string(),
    };
    
    storage.records.push(record);
    save_history(&storage)?;
    
    Ok(id)
}

/// 获取迁移历史记录
/// 返回所有迁移记录，供前端展示
#[tauri::command]
fn get_migration_history() -> Result<Vec<MigrationRecord>, String> {
    let storage = load_history();
    // 只返回状态为 active 的记录（已恢复的不显示）
    let active_records: Vec<MigrationRecord> = storage.records
        .into_iter()
        .filter(|r| r.status == "active")
        .collect();
    Ok(active_records)
}

/// 获取所有已迁移应用的原始路径列表
/// 用于前端判断应用是否已迁移
#[tauri::command]
fn get_migrated_paths() -> Result<Vec<String>, String> {
    let storage = load_history();
    let paths: Vec<String> = storage.records
        .iter()
        .filter(|r| r.status == "active")
        .map(|r| r.original_path.clone())
        .collect();
    Ok(paths)
}

/// 恢复应用命令
/// 将已迁移的应用恢复到原始位置
/// 
/// # 恢复流程详解
/// 
/// 1. **查找记录**: 根据 ID 查找迁移记录
/// 2. **删除 Junction**: 删除原路径的目录链接
/// 3. **移回文件**: 将文件从目标路径移回原路径
/// 4. **更新记录**: 将记录状态标记为 restored
/// 
/// # 参数
/// - `history_id`: 迁移记录的唯一标识符
/// 
/// # 返回
/// - `MigrationResult`: 恢复结果
#[tauri::command]
fn restore_app(history_id: String) -> Result<MigrationResult, String> {
    #[cfg(windows)]
    {
        // ========== 步骤 1: 查找记录 ==========
        let mut storage = load_history();
        
        let record_index = storage.records
            .iter()
            .position(|r| r.id == history_id && r.status == "active");
        
        let record_index = match record_index {
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
        
        // ========== 步骤 2: 验证状态 ==========
        
        // 检查目标路径是否存在（实际文件位置）
        if !target_path.exists() {
            return Ok(MigrationResult {
                success: false,
                message: format!("目标路径不存在: {}，可能已被手动删除", record.target_path),
                new_path: None,
            });
        }
        
        // 检查原路径是否为符号链接
        // 注意：在 Windows 上，Junction 也被识别为符号链接
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
        
        // ========== 步骤 3: 删除 Junction 链接 ==========
        
        if original_path.exists() {
            // 删除符号链接（不会删除目标文件）
            // 在 Windows 上，删除 Junction 使用 remove_dir
            fs::remove_dir(&original_path).map_err(|e| {
                format!("删除符号链接失败: {}。请确保没有程序正在使用该目录。", e)
            })?;
        }
        
        // ========== 步骤 4: 移回文件 ==========
        
        // 使用 fs_extra 移动整个目录
        let mut options = CopyOptions::new();
        options.overwrite = false;
        options.copy_inside = false;
        
        // 获取原路径的父目录
        let original_parent = original_path.parent()
            .ok_or("无法获取原路径的父目录")?;
        
        // 移动目录
        move_dir(&target_path, original_parent, &options).map_err(|e| {
            // 移动失败，尝试恢复 Junction
            let _ = symlink_dir(&target_path, &original_path);
            format!("移动文件失败: {}。已恢复符号链接。", e)
        })?;
        
        // ========== 步骤 5: 更新记录状态 ==========
        
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 注册前端可调用的命令
        .invoke_handler(tauri::generate_handler![
            get_installed_apps, 
            get_disk_usage,
            check_process_locks,
            migrate_app,
            get_migration_history,
            get_migrated_paths,
            restore_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
