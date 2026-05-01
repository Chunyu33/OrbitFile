# OrbitFile

<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="OrbitFile Logo">
</p>

<p align="center">
  <strong>专业的 Windows 应用存储重定向工具</strong>
</p>

<p align="center">
  将 C 盘应用无损迁移到其他磁盘，释放系统空间，保持应用正常运行
</p>

---

## 🎯 解决的问题

Windows 用户经常面临以下困扰：

1. **C 盘空间不足** - 大量应用默认安装在 C 盘，导致系统盘空间紧张
2. **手动迁移风险高** - 直接移动应用文件夹会导致应用无法运行
3. **重装系统数据丢失** - 应用数据存放在 C 盘，重装系统后需要重新配置

**OrbitFile 的解决方案：**

- 使用 Windows 符号链接（Symbolic Link）技术，将应用无损迁移到其他磁盘
- 迁移后应用正常运行，无需修改任何配置
- 支持一键恢复，随时将应用迁回原位置

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                        OrbitFile                            │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React + TypeScript + Tailwind CSS)               │
│  ┌─────────────┬─────────────┬─────────────┐               │
│  │ AppMigration│ MigHistory  │  Settings   │  ← 页面       │
│  ├─────────────┴─────────────┴─────────────┤               │
│  │  AppList │ DiskUsageBar │ Toast │ Modal │  ← 组件       │
│  ├──────────────────────────────────────────┤               │
│  │  CSS Variables │ Component Styles        │  ← 样式系统   │
│  └──────────────────────────────────────────┘               │
├─────────────────────────────────────────────────────────────┤
│  Tauri IPC Bridge (@tauri-apps/api)                         │
├─────────────────────────────────────────────────────────────┤
│  Backend (Rust)                                             │
│  ┌──────────────────────────────────────────┐               │
│  │  Commands                                 │               │
│  │  • get_installed_apps      扫描已安装应用   │               │
│  │  • get_disk_usage          获取所有磁盘信息 │               │
│  │  • migrate_app             执行应用迁移     │               │
│  │  • cancel_migration        取消迁移         │               │
│  │  • preview_uninstall       预览卸载命令     │               │
│  │  • uninstall_application   执行官方卸载     │               │
│  │  • force_remove_application 强制删除应用    │               │
│  │  • scan_app_residue        扫描卸载残留     │               │
│  │  • execute_cleanup         执行安全清理     │               │
│  │  • restore_app             恢复应用         │               │
│  │  • open_folder             打开文件夹       │               │
│  │  • get_migration_history   获取迁移历史     │               │
│  │  • get_large_folders       获取大文件夹列表（统一API）│       │
│  │  • add_custom_folder       添加自定义文件夹 │               │
│  │  • remove_custom_folder    移除自定义文件夹 │               │
│  │  • migrate_large_folder    迁移大文件夹     │               │
│  │  • restore_large_folder    恢复大文件夹     │               │
│  │  • open_data_dir           打开数据目录     │               │
│  │  • clean_ghost_links       清理幽灵链接     │               │
│  ├──────────────────────────────────────────┤               │
│  │  Core Logic                               │               │
│  │  • 注册表扫描 (winreg)                    │               │
│  │  • 符号链接创建 (std::os::windows)        │               │
│  │  • 文件操作 (fs_extra)                    │               │
│  │  • 进程检测 (sysinfo)                     │               │
│  └──────────────────────────────────────────┘               │
├─────────────────────────────────────────────────────────────┤
│  Windows OS                                                 │
│  • NTFS Symbolic Links (符号链接)                           │
│  • Registry (注册表)                                        │
│  • File System (文件系统)                                   │
└─────────────────────────────────────────────────────────────┘
```

## 📁 项目结构

```
orbit-file/
├── src/                          # 前端源码
│   ├── components/               # React 组件
│   │   ├── AppList.tsx          # 应用列表（含批量选择）
│   │   ├── CleanupModal.tsx     # 残留清理弹窗
│   │   ├── DiskUsageBar.tsx     # 磁盘使用率
│   │   ├── FilterSelect.tsx     # 下拉筛选组件
│   │   ├── MigrationModal.tsx   # 迁移进度弹窗
│   │   ├── TitleBar.tsx         # 标题栏（集成 Tab 导航 + 磁盘状态）
│   │   └── Toast.tsx            # 通知组件
│   ├── pages/                    # 页面
│   │   ├── AppMigration.tsx     # 应用迁移页（还原/卸载/批量）
│   │   ├── LargeFolders.tsx     # 数据迁移页
│   │   ├── MigrationHistory.tsx # 迁移历史页
│   │   └── Settings.tsx         # 设置页
│   ├── utils/                    # 工具函数
│   │   └── logger.ts            # 统一日志工具
│   ├── styles/                   # 样式系统
│   │   ├── variables.css        # CSS 变量定义
│   │   └── components.css       # 通用组件样式
│   ├── App.tsx                   # 主应用
│   ├── index.css                 # 全局样式
│   └── types.ts                  # TypeScript 类型定义
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs               # 核心命令注册
│   │   └── app_manager/         # 应用管理模块
│   │       ├── mod.rs
│   │       ├── scanner.rs       # 注册表/文件系统扫描
│   │       ├── migration.rs     # 迁移引擎
│   │       ├── uninstaller.rs   # 卸载/残留扫描/强制删除
│   │       ├── detector.rs      # 特殊目录动态检测
│   │       └── log_macros.rs    # 统一日志宏
│   ├── capabilities/
│   │   └── default.json         # Tauri 权限配置
│   ├── icons/                    # 应用图标
│   ├── Cargo.toml               # Rust 依赖
│   └── tauri.conf.json          # Tauri 配置
├── scripts/                      # 工具脚本
│   ├── generate-icons.js        # PNG 图标生成
│   └── generate-ico.js          # ICO 文件生成
└── package.json                  # Node.js 依赖
```

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18.0
- **Rust** >= 1.70
- **Windows 10/11** (仅支持 Windows)

### 安装依赖

```bash
# 安装前端依赖
npm install

# Rust 依赖会在构建时自动安装
```

### 开发模式

```bash
npm run tauri dev
```

### 构建发布版

```bash
npm run tauri build
```

## ⚠️ 注意事项

### 使用前必读

1. **管理员权限**
   - 创建符号链接需要管理员权限
   - 请以管理员身份运行应用

2. **迁移前检查**
   - 确保目标磁盘有足够空间
   - 关闭正在运行的目标应用
   - 建议先备份重要数据

3. **不建议迁移的应用**
   - 系统核心组件（Windows 自带应用）
   - 驱动程序相关应用
   - 杀毒软件等安全软件

4. **迁移后注意**
   - 迁移后的应用通过符号链接访问
   - 请勿删除目标位置的文件
   - 如需卸载应用，建议先恢复到原位置

### 技术限制

- 仅支持 NTFS 文件系统
- 目标磁盘必须是本地磁盘（不支持网络驱动器）
- 部分应用可能因硬编码路径而无法正常工作

## 🛠️ 图标生成

项目提供了图标生成脚本：

```bash
# 1. 生成各尺寸 PNG 图标
node scripts/generate-icons.js

# 2. 生成 Windows ICO 文件
node scripts/generate-ico.js
```

源 SVG 文件位于 `src-tauri/icons/icon.svg`

## ✨ 功能特性

### 应用图标提取

OrbitFile 使用 Windows Win32 API 提取应用的真实图标：

- **ExtractIconExW** - 从 EXE/DLL 文件中提取图标
- **GetIconInfo / GetDIBits** - 将图标转换为位图数据
- **图标缓存** - 使用内存缓存避免重复提取，提升性能

### 多磁盘显示

首页顶部显示所有本地磁盘的使用情况：

- 支持横向滚动，适配多分区用户
- 系统盘（C:）优先显示并高亮
- 根据使用率显示不同颜色（绿色 < 70% < 黄色 < 90% < 红色）

### 批量迁移

支持多选应用一键批量迁移：

- 每行 hover 显示复选框，顶部「全选未迁移」快捷操作
- 选中后显示浮动「批量迁移 (N)」按钮
- 选择统一目标目录后按序自动执行，单应用迁移失败不影响后续
- 完成后汇总通知（成功/失败数量）

### 还原 Loading 反馈

点击已迁移应用的「还原」按钮时：
- 按钮立即切换为 loading 态（spinner + "还原中"）
- 还原完成/失败后自动恢复，配合 Toast 通知结果

### 数据迁移

支持迁移系统文件夹、应用数据和自定义文件夹：

**系统文件夹：**
- 桌面 (Desktop)、文档 (Documents)、下载 (Downloads)、图片 (Pictures)、视频 (Videos)

**应用数据（动态检测路径，含注册表/配置文件回退）：**
- 微信 / 企业微信 / QQ / 钉钉 / 飞书（含 6 个候选路径）
- Chrome 缓存 / Edge 缓存 / VS Code 扩展 / npm 全局包

**新功能：**
- **统一扫描 API** — 后端单命令返回全部文件夹，动态检测路径优先，硬编码兜底
- **异步大小计算** — 先返回列表（size=0），后台线程计算后通过 Event 增量推送
- **自定义文件夹** — 支持手动添加任意文件夹，持久化记忆
- **迁移进度 + 取消** — `migrate_large_folder` 复用核心迁移引擎，支持实时进度条和取消操作
- **系统文件夹进程预检** — 迁移前检测 explorer.exe 占用，弹出警告确认对话框

**安全特性：**
- 系统文件夹迁移前显示风险警告
- 自动检测进程占用，提示关闭相关应用
- 支持一键恢复到原位置

### 强力卸载与数字残留扫描

OrbitFile 的强力卸载对标 Geek Uninstaller 等专业工具，提供完整的卸载 → 残留扫描 → 安全清理链路：

**卸载命令执行：**
1. 预览卸载命令（`preview_uninstall`），在确认对话框中展示
2. 三级回退执行策略：直接 exe → cmd /C → start /wait
3. 自动检测权限不足 → PowerShell Start-Process -Verb RunAs 提权重试
4. 静默参数追加（/S /silent /verysilent /qn /quiet）
5. 轮询注册表确认卸载完成（最多 240×500ms）

**强制删除（Force Remove）：**
- 当应用卸载程序损坏/缺失时，自动提供强制删除选项
- 直接删除安装目录（三级回退：直接删 → 清除只读 → takeown + icacls）
- 清理注册表 Uninstall 键

**残留扫描（三路并行）：**
1. 文件系统扫描：AppData / LocalAppData / ProgramData / 安装路径，深度 5
2. Uninstall 注册表扫描：HKLM + HKCU × 3 路径
3. 发布商路径扫描：Software\\<Publisher> × 4 路径（HKLM/HKCU × 普通/WOW6432Node）
4. 文件关联扫描：Software\\Classes\\Applications\\<appname> × 2 路径

**安全清理：**
- 系统目录黑名单（Windows、System32 等）
- 注册表安全校验（拒绝 Microsoft/Windows、要求 ≥3 级路径）
- 批量选中 + 一键清理，按体积降序排列

### 设置持久化

用户设置保存在 localStorage 中：

- 默认迁移目标路径
- 删除文件移入回收站（可关闭，关闭后直接彻底删除）
- 数据存储目录自定义（支持迁移到自定义路径，自动复制历史数据）

### 迁移历史持久化

迁移历史记录保存在 `%APPDATA%/orbit-file/migration_history.json`：

- **原子写入**：先写入临时文件 (`.json.tmp`)，再重命名覆盖目标文件，防止断电/崩溃导致数据损坏
- **自动备份**：每次保存前自动备份上一版本到 `.json.bak`
- **版本字段**：支持未来格式升级的平滑迁移

## 📝 开发说明

### CSS 变量系统

项目使用模块化 CSS 变量系统，定义在 `src/styles/variables.css`：

- **颜色变量**: `--color-primary`, `--color-success`, `--color-warning`, `--color-danger`
- **间距变量**: `--spacing-1` 到 `--spacing-16`（基于 4px）
- **圆角变量**: `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`
- **阴影变量**: `--shadow-sm`, `--shadow-md`, `--shadow-lg`

### 添加新命令

1. 在 `src-tauri/src/lib.rs` 中添加 Rust 函数并标记 `#[tauri::command]`
2. 在 `tauri::Builder` 中注册命令
3. 前端通过 `invoke('command_name', { args })` 调用

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
