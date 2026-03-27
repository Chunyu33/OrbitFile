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
│  │  • get_installed_apps    扫描已安装应用   │               │
│  │  • get_disk_usage        获取所有磁盘信息 │               │
│  │  • migrate_app           执行应用迁移     │               │
│  │  • uninstall_application 执行官方卸载     │               │
│  │  • scan_app_residue      扫描卸载残留     │               │
│  │  • execute_cleanup       执行安全清理     │               │
│  │  • restore_app           恢复应用         │               │
│  │  • open_folder           打开文件夹       │               │
│  │  • get_migration_history 获取迁移历史     │               │
│  │  • get_large_folders     获取大文件夹列表 │               │
│  │  • migrate_large_folder  迁移大文件夹     │               │
│  │  • restore_large_folder  恢复大文件夹     │               │
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
│   │   ├── AppList.tsx          # 应用列表
│   │   ├── DiskUsageBar.tsx     # 磁盘使用率
│   │   ├── MigrationModal.tsx   # 迁移进度弹窗
│   │   ├── TabBar.tsx           # 顶部导航
│   │   └── Toast.tsx            # 通知组件
│   ├── pages/                    # 页面
│   │   ├── AppMigration.tsx     # 应用迁移页
│   │   ├── LargeFolders.tsx     # 大文件目录页
│   │   ├── MigrationHistory.tsx # 迁移历史页
│   │   └── Settings.tsx         # 设置页
│   ├── styles/                   # 样式系统
│   │   ├── variables.css        # CSS 变量定义
│   │   └── components.css       # 通用组件样式
│   ├── App.tsx                   # 主应用
│   ├── index.css                 # 全局样式
│   └── types.ts                  # TypeScript 类型定义
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   └── lib.rs               # 核心逻辑和命令
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

### 大文件目录迁移

支持迁移系统文件夹和办公软件数据目录：

**系统文件夹：**
- 桌面 (Desktop)
- 文档 (Documents)
- 下载 (Downloads)
- 图片 (Pictures)
- 视频 (Videos)

**办公软件数据：**
- 微信 (`%USERPROFILE%\Documents\WeChat Files`)
- 企业微信 (`%USERPROFILE%\Documents\WXWork`)
- QQ (`%USERPROFILE%\Documents\Tencent Files`)
- 钉钉 (`%APPDATA%\DingTalk`)
- 飞书 (`%APPDATA%\LarkShell` 或 `%LOCALAPPDATA%\LarkShell`)

**安全特性：**
- 系统文件夹迁移前显示风险警告
- 自动检测进程占用，提示关闭相关应用
- 支持一键恢复到原位置

### 强力卸载与数字残留扫描

OrbitFile 的强力卸载采用“官方卸载优先 + 手动确认扫描 + 安全清理”流程：

1. 先执行应用官方卸载命令，并等待进程完成（必要时会触发提权执行）。
2. 卸载完成后由用户手动触发残留扫描，避免在安装器尚未落盘时误判。
3. 后端基于应用名、发布商、安装路径等指纹定位数字残留（文件系统与注册表）。
4. 清理阶段使用系统目录黑名单与注册表安全校验，阻断高风险路径删除。

该机制可覆盖常规卸载器常见遗漏（AppData 日志/缓存、注册表残留），同时尽量保证系统稳定性。

### 设置持久化

用户设置保存在 localStorage 中：

- 默认迁移目标路径
- 迁移前备份开关
- 文件完整性校验开关

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
