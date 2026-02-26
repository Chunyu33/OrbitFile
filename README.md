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
│  │  • get_disk_usage        获取磁盘信息     │               │
│  │  • migrate_app           执行应用迁移     │               │
│  │  • restore_app           恢复应用         │               │
│  │  • get_migration_history 获取迁移历史     │               │
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
