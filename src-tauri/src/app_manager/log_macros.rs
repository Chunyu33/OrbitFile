// 统一后端日志宏
// 替代零散的 eprintln!，所有日志统一前缀格式

/// 日志级别标记：INFO / WARN / ERROR
macro_rules! orbit_log {
    ($level:expr, $module:expr, $($arg:tt)*) => {
        eprintln!("[orbit-file][{}][{}] {}", $level, $module, format!($($arg)*))
    };
}

// 便捷宏
macro_rules! log_info {
    ($module:expr, $($arg:tt)*) => { orbit_log!("INFO", $module, $($arg)*) };
}
macro_rules! log_warn {
    ($module:expr, $($arg:tt)*) => { orbit_log!("WARN", $module, $($arg)*) };
}
macro_rules! log_error {
    ($module:expr, $($arg:tt)*) => { orbit_log!("ERROR", $module, $($arg)*) };
}

// 按需 use：需要时在调用处添加对应宏名即可

