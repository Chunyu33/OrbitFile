// 磁盘使用情况扫描模块
// 使用 sysinfo crate 获取系统所有磁盘的容量和可用空间信息

use sysinfo::Disks;
use crate::models::DiskUsage;

/// 获取所有磁盘使用情况
/// 使用 sysinfo 读取系统磁盘信息，按盘符排序（系统盘优先）
#[tauri::command]
pub fn get_disk_usage() -> Result<Vec<DiskUsage>, String> {
    let disks = Disks::new_with_refreshed_list();
    let mut result: Vec<DiskUsage> = Vec::new();

    for disk in disks.list() {
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        let total_space = disk.total_space();

        // 跳过容量为 0 的磁盘（如虚拟磁盘）
        if total_space == 0 {
            continue;
        }

        let free_space = disk.available_space();
        let used_space = total_space.saturating_sub(free_space);
        let usage_percent = if total_space > 0 {
            (used_space as f64 / total_space as f64) * 100.0
        } else {
            0.0
        };

        let disk_name = disk.name().to_string_lossy().to_string();
        let name = if disk_name.is_empty() {
            if mount_point.starts_with("C:") { "系统".to_string() }
            else { "本地磁盘".to_string() }
        } else {
            disk_name
        };

        let is_system = mount_point.starts_with("C:") || mount_point == "/";

        result.push(DiskUsage {
            mount_point, name, total_space, free_space, used_space,
            usage_percent, is_system,
        });
    }

    // 系统盘优先，其余按盘符排序
    result.sort_by(|a, b| {
        if a.is_system && !b.is_system {
            std::cmp::Ordering::Less
        } else if !a.is_system && b.is_system {
            std::cmp::Ordering::Greater
        } else {
            a.mount_point.cmp(&b.mount_point)
        }
    });

    if result.is_empty() {
        Err("无法获取磁盘信息".to_string())
    } else {
        Ok(result)
    }
}
