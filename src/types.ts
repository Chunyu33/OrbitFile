// OrbitFile 类型定义文件

/**
 * 已安装应用信息接口
 * 对应 Rust 后端的 InstalledApp 结构体
 */
export interface InstalledApp {
  // 应用显示名称
  display_name: string;
  // 安装位置路径
  install_location: string;
  // 应用图标路径
  display_icon: string;
  // 预估大小（KB）
  estimated_size: number;
  // 应用图标的 Base64 编码数据（PNG 格式）
  // 如果提取失败则为空字符串
  icon_base64: string;
}

/**
 * 磁盘使用信息接口
 * 对应 Rust 后端的 DiskUsage 结构体
 */
export interface DiskUsage {
  // 总容量（字节）
  total_space: number;
  // 可用空间（字节）
  free_space: number;
  // 已使用空间（字节）
  used_space: number;
  // 使用百分比
  usage_percent: number;
}

/**
 * Tab 页面类型枚举
 */
export type TabType = 'migration' | 'history' | 'settings';

/**
 * 迁移结果接口
 * 对应 Rust 后端的 MigrationResult 结构体
 */
export interface MigrationResult {
  // 是否成功
  success: boolean;
  // 结果消息
  message: string;
  // 新的安装路径（成功时返回）
  new_path: string | null;
}

/**
 * 进程锁检测结果接口
 * 对应 Rust 后端的 ProcessLockResult 结构体
 */
export interface ProcessLockResult {
  // 是否有进程占用
  is_locked: boolean;
  // 占用进程名称列表
  processes: string[];
}

/**
 * 迁移步骤枚举
 */
export type MigrationStep = 
  | 'idle'           // 空闲状态
  | 'checking'       // 检查进程锁
  | 'copying'        // 复制文件
  | 'linking'        // 创建链接
  | 'success'        // 迁移成功
  | 'error';         // 迁移失败

/**
 * 迁移历史记录接口
 * 对应 Rust 后端的 MigrationRecord 结构体
 */
export interface MigrationRecord {
  // 唯一标识符
  id: string;
  // 应用名称
  app_name: string;
  // 原始路径
  original_path: string;
  // 目标路径
  target_path: string;
  // 迁移大小（字节）
  size: number;
  // 迁移时间（Unix 时间戳，毫秒）
  migrated_at: number;
  // 状态
  status: string;
}
