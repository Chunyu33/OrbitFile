// 大文件目录页面
// 显示系统文件夹和办公软件数据文件夹，支持迁移和恢复

import { useEffect, useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { 
  RefreshCw, 
  FolderOpen, 
  AlertTriangle,
  Link2,
  Undo2,
  Monitor,
  FileText,
  Download,
  Image,
  Video,
  MessageCircle,
  Building2,
  Users,
  Phone,
  Bird
} from 'lucide-react';
import Toast, { useToast } from '../components/Toast';
import { LargeFolder, MigrationResult, ProcessLockResult } from '../types';

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 根据图标 ID 返回对应的图标组件
function getFolderIcon(iconId: string) {
  const iconMap: Record<string, React.ReactNode> = {
    desktop: <Monitor className="w-5 h-5" />,
    documents: <FileText className="w-5 h-5" />,
    downloads: <Download className="w-5 h-5" />,
    pictures: <Image className="w-5 h-5" />,
    videos: <Video className="w-5 h-5" />,
    wechat: <MessageCircle className="w-5 h-5" />,
    wxwork: <Building2 className="w-5 h-5" />,
    qq: <Users className="w-5 h-5" />,
    dingtalk: <Phone className="w-5 h-5" />,
    feishu: <Bird className="w-5 h-5" />,
  };
  return iconMap[iconId] || <FolderOpen className="w-5 h-5" />;
}

// 根据文件夹类型返回颜色
function getFolderColor(folder: LargeFolder): string {
  if (folder.is_junction) return 'var(--color-success)';
  if (folder.folder_type === 'System') return 'var(--color-warning)';
  return 'var(--color-primary)';
}

// 风险确认弹窗组件
function RiskConfirmModal({ 
  isOpen, 
  folder, 
  onConfirm, 
  onCancel 
}: { 
  isOpen: boolean; 
  folder: LargeFolder | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!isOpen || !folder) return null;

  const isSystemFolder = folder.folder_type === 'System';

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div 
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-xl)',
          padding: '24px',
          maxWidth: '480px',
          width: '90%',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* 标题 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div 
            style={{ 
              width: '40px', 
              height: '40px', 
              borderRadius: 'var(--radius-lg)',
              background: isSystemFolder ? 'var(--color-danger-light)' : 'var(--color-warning-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangle 
              style={{ 
                width: '20px', 
                height: '20px', 
                color: isSystemFolder ? 'var(--color-danger)' : 'var(--color-warning)' 
              }} 
            />
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              {isSystemFolder ? '系统文件夹迁移风险警告' : '确认迁移'}
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              {folder.display_name} - {formatSize(folder.size)}
            </p>
          </div>
        </div>

        {/* 内容 */}
        <div style={{ marginBottom: '20px' }}>
          {isSystemFolder ? (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <p style={{ marginBottom: '12px' }}>
                <strong style={{ color: 'var(--color-danger)' }}>⚠️ 高风险操作</strong>
              </p>
              <p style={{ marginBottom: '8px' }}>
                您正在尝试迁移系统文件夹 <strong>"{folder.display_name}"</strong>，这可能会导致：
              </p>
              <ul style={{ paddingLeft: '20px', marginBottom: '12px' }}>
                <li>部分应用程序无法正常访问该文件夹</li>
                <li>Windows 系统功能异常</li>
                <li>文件同步服务（如 OneDrive）出现问题</li>
              </ul>
              <p style={{ color: 'var(--color-danger)' }}>
                建议：仅在您完全了解风险的情况下继续操作。
              </p>
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <p style={{ marginBottom: '8px' }}>
                即将迁移 <strong>"{folder.display_name}"</strong> 数据文件夹。
              </p>
              <p style={{ marginBottom: '8px' }}>
                迁移前请确保：
              </p>
              <ul style={{ paddingLeft: '20px' }}>
                <li>已关闭 {folder.display_name} 应用程序</li>
                <li>目标磁盘有足够的可用空间</li>
              </ul>
            </div>
          )}
        </div>

        {/* 按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            onClick={onCancel}
            className="btn btn-secondary"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="btn"
            style={{ 
              background: isSystemFolder ? 'var(--color-danger)' : 'var(--color-primary)',
              color: 'white',
            }}
          >
            {isSystemFolder ? '我了解风险，继续迁移' : '确认迁移'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 文件夹卡片组件
function FolderCard({ 
  folder, 
  onMigrate, 
  onRestore,
  onOpenFolder 
}: { 
  folder: LargeFolder;
  onMigrate: (folder: LargeFolder) => void;
  onRestore: (folder: LargeFolder) => void;
  onOpenFolder: (path: string) => void;
}) {
  const iconColor = getFolderColor(folder);
  const isSystem = folder.folder_type === 'System';
  const notFound = !folder.exists;

  return (
    <div 
      style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-color)',
        padding: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        opacity: notFound ? 0.6 : 1,
      }}
    >
      {/* 图标 */}
      <div 
        style={{
          width: '44px',
          height: '44px',
          borderRadius: 'var(--radius-lg)',
          background: notFound ? 'var(--color-gray-100)' : folder.is_junction ? 'var(--color-success-light)' : isSystem ? 'var(--color-warning-light)' : 'var(--color-primary-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: notFound ? 'var(--text-muted)' : iconColor,
          flexShrink: 0,
        }}
      >
        {getFolderIcon(folder.icon_id)}
      </div>

      {/* 信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: notFound ? 'var(--text-muted)' : 'var(--text-primary)' }}>
            {folder.display_name}
          </span>
          {notFound && (
            <span 
              style={{ 
                fontSize: '10px', 
                padding: '2px 6px', 
                borderRadius: '4px',
                background: 'var(--color-gray-100)',
                color: 'var(--text-muted)',
                fontWeight: 500,
              }}
            >
              未检测到
            </span>
          )}
          {!notFound && isSystem && !folder.is_junction && (
            <span 
              style={{ 
                fontSize: '10px', 
                padding: '2px 6px', 
                borderRadius: '4px',
                background: 'var(--color-warning-light)',
                color: 'var(--color-warning)',
                fontWeight: 500,
              }}
            >
              系统文件夹
            </span>
          )}
          {folder.is_junction && (
            <span className="badge badge-success">
              <Link2 className="w-3 h-3" />
              已迁移
            </span>
          )}
        </div>
        <p 
          style={{ 
            fontSize: '12px', 
            color: 'var(--text-muted)', 
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={folder.path}
        >
          {notFound ? `默认路径: ${folder.path}` : folder.path}
        </p>
        {folder.is_junction && folder.junction_target && (
          <p 
            style={{ 
              fontSize: '11px', 
              color: 'var(--color-success)', 
              margin: '4px 0 0 0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={`实际位置: ${folder.junction_target}`}
          >
            → {folder.junction_target}
          </p>
        )}
        {notFound && (
          <p 
            style={{ 
              fontSize: '11px', 
              color: 'var(--text-muted)', 
              margin: '4px 0 0 0',
              fontStyle: 'italic',
            }}
          >
            可能未安装或数据存储在自定义位置
          </p>
        )}
      </div>

      {/* 大小 */}
      <div style={{ textAlign: 'right', minWidth: '80px', flexShrink: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: notFound ? 'var(--text-muted)' : 'var(--text-primary)' }}>
          {notFound ? '—' : folder.is_junction ? '已迁移' : formatSize(folder.size)}
        </div>
        {!notFound && !folder.is_junction && folder.size > 0 && (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            可释放
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {!notFound && (
          <button
            onClick={() => onOpenFolder(folder.path)}
            className="btn btn-icon btn-ghost"
            title="打开文件夹"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        )}

        {notFound ? (
          <button
            className="btn btn-secondary"
            style={{ minWidth: '80px' }}
            disabled
          >
            不可用
          </button>
        ) : folder.is_junction ? (
          <button
            onClick={() => onRestore(folder)}
            className="btn btn-secondary"
            style={{ minWidth: '80px' }}
          >
            <Undo2 className="w-4 h-4" />
            恢复
          </button>
        ) : (
          <button
            onClick={() => onMigrate(folder)}
            className="btn btn-primary"
            style={{ minWidth: '80px' }}
            disabled={folder.size === 0}
          >
            迁移
          </button>
        )}
      </div>
    </div>
  );
}

export default function LargeFolders() {
  const [folders, setFolders] = useState<LargeFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // 风险确认弹窗状态
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    folder: LargeFolder | null;
    targetDir: string | null;
  }>({ isOpen: false, folder: null, targetDir: null });
  
  // Toast 通知
  const { toast, showToast, hideToast } = useToast();

  // 计算可释放的总空间
  const totalReclaimable = useMemo(() => {
    return folders
      .filter(f => !f.is_junction && f.exists)
      .reduce((sum, f) => sum + f.size, 0);
  }, [folders]);

  // 已迁移的文件夹数量
  const migratedCount = useMemo(() => {
    return folders.filter(f => f.is_junction).length;
  }, [folders]);

  async function fetchFolders() {
    try {
      setLoading(true);
      const result = await invoke<LargeFolder[]>('get_large_folders');
      setFolders(result);
    } catch (error) {
      console.error('获取大文件夹列表失败:', error);
      showToast('获取文件夹列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchFolders();
    setRefreshing(false);
  }

  async function openFolder(path: string) {
    try {
      await invoke('open_folder', { path });
    } catch (error) {
      console.error('打开文件夹失败:', error);
      showToast('打开文件夹失败', 'error');
    }
  }

  // 开始迁移流程
  async function handleMigrate(folder: LargeFolder) {
    // 检查进程锁
    if (folder.app_process_names.length > 0) {
      try {
        const lockResult = await invoke<ProcessLockResult>('check_process_locks', { 
          sourcePath: folder.path 
        });
        
        if (lockResult.is_locked) {
          showToast(
            `请先关闭以下程序: ${lockResult.processes.join(', ')}`,
            'error'
          );
          return;
        }
      } catch (error) {
        console.error('检查进程锁失败:', error);
      }
    }

    // 选择目标目录
    const targetDir = await open({
      directory: true,
      title: `选择 "${folder.display_name}" 的迁移目标位置`,
    });

    if (!targetDir) return;

    // 显示风险确认弹窗
    setConfirmModal({
      isOpen: true,
      folder,
      targetDir: targetDir as string,
    });
  }

  // 确认迁移
  async function confirmMigrate() {
    const { folder, targetDir } = confirmModal;
    if (!folder || !targetDir) return;

    setConfirmModal({ isOpen: false, folder: null, targetDir: null });

    try {
      showToast(`正在迁移 ${folder.display_name}...`, 'info');
      
      const result = await invoke<MigrationResult>('migrate_large_folder', {
        sourcePath: folder.path,
        targetDir,
      });

      if (result.success) {
        showToast(result.message, 'success');
        await fetchFolders();
      } else {
        showToast(result.message, 'error');
      }
    } catch (error) {
      console.error('迁移失败:', error);
      showToast(`迁移失败: ${error}`, 'error');
    }
  }

  // 恢复文件夹
  async function handleRestore(folder: LargeFolder) {
    // 检查进程锁
    if (folder.app_process_names.length > 0) {
      try {
        const lockResult = await invoke<ProcessLockResult>('check_process_locks', { 
          sourcePath: folder.path 
        });
        
        if (lockResult.is_locked) {
          showToast(
            `请先关闭以下程序: ${lockResult.processes.join(', ')}`,
            'error'
          );
          return;
        }
      } catch (error) {
        console.error('检查进程锁失败:', error);
      }
    }

    try {
      showToast(`正在恢复 ${folder.display_name}...`, 'info');
      
      const result = await invoke<MigrationResult>('restore_large_folder', {
        junctionPath: folder.path,
      });

      if (result.success) {
        showToast(result.message, 'success');
        await fetchFolders();
      } else {
        showToast(result.message, 'error');
      }
    } catch (error) {
      console.error('恢复失败:', error);
      showToast(`恢复失败: ${error}`, 'error');
    }
  }

  useEffect(() => {
    fetchFolders();
  }, []);

  // 分组：系统文件夹和应用数据
  const systemFolders = folders.filter(f => f.folder_type === 'System');
  const appDataFolders = folders.filter(f => f.folder_type === 'AppData');

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ padding: 'var(--spacing-4) var(--spacing-5)' }}>
      <div className="h-full max-w-5xl mx-auto flex flex-col w-full" style={{ gap: 'var(--spacing-4)' }}>
        {/* 顶部统计 */}
        <header className="flex items-center justify-between flex-shrink-0">
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            {/* 可释放空间 */}
            <div 
              style={{
                padding: '12px 20px',
                background: 'var(--color-primary-light)',
                borderRadius: 'var(--radius-lg)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div style={{ color: 'var(--color-primary)' }}>
                <FolderOpen className="w-5 h-5" />
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>可释放空间</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-primary)' }}>
                  {loading ? '计算中...' : formatSize(totalReclaimable)}
                </div>
              </div>
            </div>

            {/* 已迁移数量 */}
            {migratedCount > 0 && (
              <div 
                style={{
                  padding: '12px 20px',
                  background: 'var(--color-success-light)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ color: 'var(--color-success)' }}>
                  <Link2 className="w-5 h-5" />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>已迁移</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-success)' }}>
                    {migratedCount} 个
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn btn-secondary"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </header>

        {/* 内容区域 */}
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ paddingRight: '4px' }}>
          {loading ? (
            // 加载骨架屏
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <div 
                  key={i}
                  className="animate-pulse"
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-color)',
                    padding: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                  }}
                >
                  <div style={{ width: '44px', height: '44px', borderRadius: 'var(--radius-lg)', background: 'var(--color-gray-100)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ width: '120px', height: '16px', borderRadius: '4px', background: 'var(--color-gray-100)', marginBottom: '8px' }} />
                    <div style={{ width: '200px', height: '12px', borderRadius: '4px', background: 'var(--color-gray-100)' }} />
                  </div>
                  <div style={{ width: '80px', height: '32px', borderRadius: 'var(--radius-md)', background: 'var(--color-gray-100)' }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* 系统文件夹 */}
              {systemFolders.length > 0 && (
                <section>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                      系统文件夹
                    </h2>
                    <span 
                      style={{ 
                        fontSize: '10px', 
                        padding: '2px 8px', 
                        borderRadius: '4px',
                        background: 'var(--color-warning-light)',
                        color: 'var(--color-warning)',
                      }}
                    >
                      <AlertTriangle className="w-3 h-3 inline mr-1" />
                      迁移需谨慎
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {systemFolders.map((folder) => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        onMigrate={handleMigrate}
                        onRestore={handleRestore}
                        onOpenFolder={openFolder}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* 应用数据文件夹 */}
              {appDataFolders.length > 0 && (
                <section>
                  <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px 0' }}>
                    应用数据
                  </h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {appDataFolders.map((folder) => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        onMigrate={handleMigrate}
                        onRestore={handleRestore}
                        onOpenFolder={openFolder}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* 空状态 */}
              {folders.length === 0 && (
                <div 
                  style={{
                    textAlign: 'center',
                    padding: '60px 20px',
                    color: 'var(--text-muted)',
                  }}
                >
                  <FolderOpen style={{ width: '48px', height: '48px', margin: '0 auto 16px', opacity: 0.5 }} />
                  <p style={{ fontSize: '14px', margin: 0 }}>未检测到可迁移的大文件夹</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 风险确认弹窗 */}
      <RiskConfirmModal
        isOpen={confirmModal.isOpen}
        folder={confirmModal.folder}
        onConfirm={confirmMigrate}
        onCancel={() => setConfirmModal({ isOpen: false, folder: null, targetDir: null })}
      />

      {/* Toast 通知 */}
      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
        onClose={hideToast}
      />
    </div>
  );
}
