// 数据迁移页面
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
import { LargeFolder, MigrationResult, ProcessLockResult, SpecialFolder } from '../types';

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

// 特殊目录元数据映射（用于 UI 显示与进程预检）
const SPECIAL_FOLDER_META: Record<string, { displayName: string; iconId: string; processNames: string[] }> = {
  wechat: { displayName: '微信', iconId: 'wechat', processNames: ['WeChat.exe'] },
  qq: { displayName: 'QQ', iconId: 'qq', processNames: ['QQ.exe'] },
  tim: { displayName: 'TIM', iconId: 'qq', processNames: ['TIM.exe'] },
  wxwork: { displayName: '企业微信', iconId: 'wxwork', processNames: ['WXWork.exe'] },
  dingtalk: { displayName: '钉钉', iconId: 'dingtalk', processNames: ['DingTalk.exe'] },
  feishu: { displayName: '飞书', iconId: 'feishu', processNames: ['Feishu.exe', 'Lark.exe'] },
};

function toLargeFolder(special: SpecialFolder): LargeFolder {
  const meta = SPECIAL_FOLDER_META[special.name] ?? {
    displayName: special.name,
    iconId: 'folder',
    processNames: [],
  };

  const sizeBytes = Math.max(0, Math.round(special.size_mb * 1024 * 1024));

  return {
    id: special.name,
    display_name: meta.displayName,
    path: special.current_path,
    size: sizeBytes,
    folder_type: 'AppData',
    is_junction: false,
    junction_target: null,
    app_process_names: meta.processNames,
    icon_id: meta.iconId,
    exists: special.is_detected,
  };
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
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            className="h-8 px-4 text-[13px] font-medium rounded-md border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="h-8 px-4 text-[13px] font-medium rounded-md text-white transition-opacity hover:opacity-90"
            style={{ background: isSystemFolder ? '#DC2626' : 'var(--color-primary)' }}
          >
            {isSystemFolder ? '我了解风险，继续迁移' : '确认迁移'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 文件夹行组件
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
  const isSystem = folder.folder_type === 'System';
  const notFound = !folder.exists;

  const iconBg = notFound
    ? 'bg-[var(--bg-hover)]'
    : folder.is_junction
    ? 'bg-emerald-500/10'
    : isSystem
    ? 'bg-amber-500/10'
    : 'bg-[var(--color-primary-light)]';

  const iconColor = notFound
    ? 'text-[var(--text-muted)]'
    : folder.is_junction
    ? 'text-emerald-600'
    : isSystem
    ? 'text-amber-600'
    : 'text-[var(--color-primary)]';

  return (
    <div className={`group flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--bg-card)] shadow-[0_1px_0_rgba(15,23,42,0.04),0_6px_18px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(15,23,42,0.1)] dark:shadow-[0_1px_0_rgba(0,0,0,0.28),0_8px_22px_rgba(0,0,0,0.28)] dark:hover:shadow-[0_12px_28px_rgba(0,0,0,0.36)] ${notFound ? 'opacity-55' : ''}`}>
      {/* 图标 */}
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg} ${iconColor}`}>
        {getFolderIcon(folder.icon_id)}
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
            {folder.display_name}
          </span>
          {notFound && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--bg-hover)] text-[var(--text-muted)]">
              未检测到
            </span>
          )}
          {!notFound && isSystem && !folder.is_junction && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/10 text-amber-600">
              系统文件夹
            </span>
          )}
          {folder.is_junction && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/10 text-emerald-600">
              <Link2 className="w-2.5 h-2.5" />
              已迁移
            </span>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] truncate" title={folder.path}>
          {folder.is_junction && folder.junction_target
            ? `→ ${folder.junction_target}`
            : notFound
            ? `默认: ${folder.path}`
            : folder.path}
        </p>
      </div>

      {/* 大小 */}
      <div className="flex-shrink-0 text-right w-20">
        <span className="inline-flex items-center h-7 px-2.5 rounded-full bg-[var(--bg-hover)]/75 text-[12px] font-semibold text-[var(--text-primary)] tabular-nums">
          {notFound ? '—' : folder.is_junction ? '—' : formatSize(folder.size)}
        </span>
        {!notFound && !folder.is_junction && folder.size > 0 && (
          <div className="text-[10px] text-[var(--text-muted)]">可释放</div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {!notFound && (
          <button
            onClick={() => onOpenFolder(folder.path)}
            className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            title="打开文件夹"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        )}

        {notFound ? (
          <button disabled className="h-7 px-3 text-[12px] font-medium rounded-md bg-[var(--bg-hover)] text-[var(--text-muted)] opacity-45 cursor-not-allowed">
            不可用
          </button>
        ) : folder.is_junction ? (
          <button
            onClick={() => onRestore(folder)}
            className="h-7 px-3 text-[12px] font-medium rounded-md bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--color-primary)] transition-colors inline-flex items-center gap-1.5"
          >
            <Undo2 className="w-3.5 h-3.5" />
            恢复
          </button>
        ) : (
          <button
            onClick={() => onMigrate(folder)}
            disabled={folder.size === 0}
            className="h-7 px-3 text-[12px] font-semibold rounded-md text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--color-primary)' }}
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

      const [allLargeFolders, specialFolders] = await Promise.all([
        invoke<LargeFolder[]>('get_large_folders'),
        invoke<SpecialFolder[]>('get_special_folders_status'),
      ]);

      const systemFolders = allLargeFolders.filter((folder) => folder.folder_type === 'System');
      const detectedSpecialFolders = specialFolders.map(toLargeFolder);

      setFolders([...systemFolders, ...detectedSpecialFolders]);
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

      const result = folder.folder_type === 'AppData'
        ? await invoke<MigrationResult>('migrate_special_folder', {
            appName: folder.id,
            sourcePath: folder.path,
            targetDir,
          })
        : await invoke<MigrationResult>('migrate_large_folder', {
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
    <div className="h-full overflow-hidden flex flex-col px-5 py-4">
      <div className="h-full max-w-5xl mx-auto flex flex-col w-full gap-3">
        {/* 顶部统计 + 刷新 */}
        <header className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* 可释放空间 */}
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)]">
              <FolderOpen className="w-4 h-4 text-[var(--color-primary)]" />
              <div>
                <div className="text-[10px] text-[var(--text-muted)]">可释放空间</div>
                <div className="text-[15px] font-bold text-[var(--color-primary)] leading-tight">
                  {loading ? '...' : formatSize(totalReclaimable)}
                </div>
              </div>
            </div>

            {/* 已迁移数量 */}
            {migratedCount > 0 && (
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)]">
                <Link2 className="w-4 h-4 text-emerald-600" />
                <div>
                  <div className="text-[10px] text-[var(--text-muted)]">已迁移</div>
                  <div className="text-[15px] font-bold text-emerald-600 leading-tight">{migratedCount} 个</div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="h-8 px-3 text-[12px] font-medium rounded-md border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </header>

        {/* 内容区域 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-1">
          {loading ? (
            <div className="space-y-2 py-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--bg-card)] animate-pulse shadow-[0_1px_0_rgba(15,23,42,0.04),0_6px_18px_rgba(15,23,42,0.06)] dark:shadow-[0_1px_0_rgba(0,0,0,0.28),0_8px_22px_rgba(0,0,0,0.28)]">
                  <div className="w-9 h-9 rounded-xl bg-[var(--bg-hover)]" />
                  <div className="flex-1">
                    <div className="h-3.5 rounded w-28 mb-1.5 bg-[var(--bg-hover)]" />
                    <div className="h-3 rounded w-48 bg-[var(--bg-hover)]" />
                  </div>
                  <div className="w-16 h-7 rounded-md bg-[var(--bg-hover)]" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-4 py-1">
              {/* 系统文件夹 */}
              {systemFolders.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">系统文件夹</h2>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/10 text-amber-600">
                      <AlertTriangle className="w-3 h-3" />
                      迁移需谨慎
                    </span>
                  </div>
                  <div className="space-y-2">
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
                  <h2 className="text-[13px] font-semibold text-[var(--text-primary)] mb-2">应用数据</h2>
                  <div className="space-y-2">
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
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 rounded-xl bg-[var(--bg-hover)] flex items-center justify-center mb-3">
                    <FolderOpen className="w-5 h-5 text-[var(--text-muted)]" />
                  </div>
                  <p className="text-[14px] font-medium text-[var(--text-primary)] mb-1">未检测到可迁移的文件夹</p>
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
