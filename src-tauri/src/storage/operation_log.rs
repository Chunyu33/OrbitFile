// 操作日志持久化模块
// 记录卸载、强制删除、残留清理的完整审计轨迹
// 最多保留 100 条记录，JSON 格式存储，新记录覆盖最旧的（FIFO 轮转）

use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::data_dir::ensure_data_dir;

/// 单条操作日志
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationLogEntry {
    pub id: String,
    /// Unix 毫秒时间戳
    pub timestamp: u64,
    /// 应用名称
    pub app_name: String,
    /// 操作类型: "uninstall" | "force_remove" | "cleanup"
    pub operation: String,
    /// 执行结果: "success" | "failure"
    pub result: String,
    /// 人类可读的操作详情
    pub details: String,
    /// 删除方式（仅 force_remove 有值: "recycle_bin" / "permanent"）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
}

/// 日志文件容器
#[derive(Debug, Clone, Serialize, Deserialize)]
struct OperationLogStorage {
    version: u32,
    /// 最新日志在前（倒序），方便前端直接展示
    logs: Vec<OperationLogEntry>,
}

/// FIFO 轮转上限
const MAX_LOG_ENTRIES: usize = 100;

/// 获取日志文件路径
fn get_log_path() -> PathBuf {
    ensure_data_dir().join("uninstall_logs.json")
}

/// 从 JSON 文件加载日志
fn load_logs() -> OperationLogStorage {
    let path = get_log_path();
    if !path.exists() {
        return OperationLogStorage { version: 1, logs: Vec::new() };
    }

    let mut file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return OperationLogStorage { version: 1, logs: Vec::new() },
    };

    let mut contents = String::new();
    if file.read_to_string(&mut contents).is_err() {
        return OperationLogStorage { version: 1, logs: Vec::new() };
    }

    serde_json::from_str(&contents).unwrap_or(OperationLogStorage { version: 1, logs: Vec::new() })
}

/// 原子写入日志文件（temp → sync → rename）
fn save_logs(storage: &OperationLogStorage) -> Result<(), String> {
    let path = get_log_path();
    let temp_path = path.with_extension("json.tmp");

    let json = serde_json::to_string_pretty(storage)
        .map_err(|e| format!("序列化日志失败: {}", e))?;

    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("创建临时文件失败: {}", e))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("写入临时文件失败: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("同步临时文件失败: {}", e))?;

    // 原子替换
    fs::rename(&temp_path, &path)
        .map_err(|e| format!("重命名日志文件失败: {}", e))?;

    Ok(())
}

/// 追加一条操作日志
///
/// 自动执行 FIFO 轮转：超过 100 条时移除最旧的记录
/// 新记录插入到列表头部（倒序存储）
pub fn add_operation_log(
    app_name: &str,
    operation: &str,
    result: &str,
    details: &str,
    method: Option<&str>,
) {
    let mut storage = load_logs();

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let id = format!("op_{}", timestamp);

    // 新日志插入到最前面（倒序）
    storage.logs.insert(0, OperationLogEntry {
        id,
        timestamp,
        app_name: app_name.to_string(),
        operation: operation.to_string(),
        result: result.to_string(),
        details: details.to_string(),
        method: method.map(|s| s.to_string()),
    });

    // 超过上限则截断最旧的记录
    if storage.logs.len() > MAX_LOG_ENTRIES {
        storage.logs.truncate(MAX_LOG_ENTRIES);
    }

    let _ = save_logs(&storage);
}

/// 获取所有操作日志（供前端查询）
#[tauri::command]
pub fn get_operation_logs() -> Result<Vec<OperationLogEntry>, String> {
    let storage = load_logs();
    Ok(storage.logs)
}
