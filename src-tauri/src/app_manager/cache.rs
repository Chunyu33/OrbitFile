// 内存级应用缓存
// 避免 Tab 切换或重复操作时触发全量扫描，迁移/卸载后增量更新

use crate::app_manager::scanner::SCANNER;
use crate::models::InstalledApp;
use std::sync::RwLock;
use std::time::Instant;

// ============================================================================
// AppCache — 全量应用快照缓存
// ============================================================================

pub struct AppCache {
    /// 全量应用列表（含图标 Base64）
    apps: Vec<InstalledApp>,
    /// 上次全量扫描时间
    last_scan_time: Instant,
    /// 脏标记：true 表示缓存失效，下次访问需重新扫描
    is_dirty: bool,
}

impl AppCache {
    fn new() -> Self {
        Self {
            apps: Vec::new(),
            last_scan_time: Instant::now(),
            is_dirty: true, // 初始状态脏，首次访问触发扫描
        }
    }

    fn is_valid(&self) -> bool {
        !self.is_dirty
    }

    fn invalidate(&mut self) {
        self.is_dirty = true;
    }
}

// ============================================================================
// 全局单例
// ============================================================================

lazy_static::lazy_static! {
    static ref APP_CACHE: RwLock<AppCache> = RwLock::new(AppCache::new());
}

// ============================================================================
// 公共 API
// ============================================================================

/// 获取应用列表：缓存有效时直接返回内存数据，否则触发全量扫描
pub fn get_or_scan() -> Result<Vec<InstalledApp>, String> {
    // 快速路径：缓存命中，仅持有读锁
    {
        let cache = APP_CACHE.read().unwrap();
        if cache.is_valid() {
            return Ok(cache.apps.clone());
        }
    }

    let mut apps = SCANNER.scan_all()?;

    // 图标复用：路径未变的条目保留原有 Base64，减少 CPU 开销
    {
        let cache = APP_CACHE.read().unwrap();
        for app in &mut apps {
            if let Some(old) = cache.apps.iter().find(|a| {
                a.install_location == app.install_location
                    && a.display_icon == app.display_icon
            }) {
                app.icon_base64 = old.icon_base64.clone();
                app.icon_url = old.icon_url.clone();
            }
        }
    }

    // 写入缓存
    {
        let mut cache = APP_CACHE.write().unwrap();
        cache.apps = apps.clone();
        cache.last_scan_time = Instant::now();
        cache.is_dirty = false;
    }

    Ok(apps)
}

/// 强制刷新：清空缓存并触发全量扫描
pub fn refresh() -> Result<Vec<InstalledApp>, String> {
    {
        let mut cache = APP_CACHE.write().unwrap();
        cache.invalidate();
    }
    get_or_scan()
}

/// 迁移成功后更新缓存：修改 install_location，重置 size 供后续异步计算
pub fn on_app_migrated(old_path: &str, new_path: &str) {
    let mut cache = APP_CACHE.write().unwrap();
    if let Some(app) = cache
        .apps
        .iter_mut()
        .find(|a| a.install_location == old_path)
    {
        app.install_location = new_path.to_string();
        app.estimated_size = 0; // 新路径大小待前端异步加载
    }
}

/// 卸载成功后从缓存中移除
pub fn on_app_uninstalled(install_location: &str) {
    let mut cache = APP_CACHE.write().unwrap();
    cache
        .apps
        .retain(|a| a.install_location != install_location);
}
