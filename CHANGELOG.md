# Changelog

## 2026-05-04 — 内存缓存架构与前端性能优化

### 后端（Rust）

**内存级应用缓存 `AppCache`** ([cache.rs](src-tauri/src/app_manager/cache.rs))
- 新增 `Arc<RwLock<AppCache>>` 全局单例，缓存全量 `InstalledApp` 快照（含图标 Base64）
- `is_dirty` 标志控制缓存有效性：clean 时零扫描直接返回，dirty 时触发全量扫描
- 图标复用：扫描结果与旧缓存比对，路径未变条目直接透传 `icon_base64`，减少 CPU 开销

**增量缓存更新**
- 迁移成功 → `on_app_migrated(old, new)` 更新 `install_location`，不触发全量重扫
- 卸载成功 → `on_app_uninstalled(loc)` 从缓存 Vec 中直接移除，不触发全量重扫
- 新增 `refresh_apps` Tauri 命令：手动标记脏 → 全量重扫

**扫描引擎重构** ([scanner.rs](src-tauri/src/app_manager/scanner.rs))
- 三级检索模型：Tier 1 深度注册表（~85%）→ Tier 2 LNK 快捷方式（~10%）→ Tier 3 受限 FS（~5%）
- 多信号融合评分 + SCORE_THRESHOLD 0.35
- 安装包一票否决（`is_installer_like_exe`）：setup/install/update/upgrader/unins 关键词 + 年份/版本号模式
- 临时目录黑名单（download/temp/cache/updater 等）
- 图标回退提取：DisplayIcon 缺失时在安装目录搜索任意 exe 提取

### 前端（React）

**性能优化**
- `sizeMap` 与 `apps` 数组解耦：大小数据独立存储，不重建 `InstalledApp` 对象
- `React.memo(AppRow)` + `startTransition`：列表更新标记为低优先级，React 可中断渲染
- `useDeferredValue` 搜索防抖
- 模块级闭包缓存：`sizeMap` 跨 Tab 切换保持，key 集合匹配时跳过全部 `get_app_size` IO 调用
- 搜索/筛选条件跨 Tab 保持

**UI 改进**
- 总占用移至列表底部 footer，居中加粗显示，按当前筛选结果实时聚合
- 应用计数旁增加手动刷新按钮（`RotateCw` 图标，刷新时旋转动画）
- Tab 渲染还原为条件挂载，避免全量 Tab 同时渲染导致的布局断裂和主线程阻塞
