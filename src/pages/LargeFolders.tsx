// 数据迁移页面
// 显示系统文件夹、应用数据文件夹和自定义文件夹，支持迁移和恢复
// 大小通过后台异步事件 "large-folder-size" 增量更新

import { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import {
  RefreshCw,
  FolderOpen,
  AlertTriangle,
  Link2,
  Undo2,
  Plus,
  X,
  Loader2,
  Monitor,
  FileText,
  Download,
  Image,
  Video,
  MessageCircle,
  Building2,
  Users,
  Phone,
  Bird,
  Globe,
  Code,
  Package,
} from 'lucide-react';
import Toast, { useToast } from '../components/Toast';
import { LargeFolder, ProcessLockResult, LargeFolderSizeEvent, LargeFolderMigrationCompleteEvent, LargeFolderRestoreCompleteEvent } from '../types';

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 根据图标 ID 返回图标组件
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
    chrome_cache: <Globe className="w-5 h-5" />,
    edge_cache: <Globe className="w-5 h-5" />,
    vscode_extensions: <Code className="w-5 h-5" />,
    npm_global: <Package className="w-5 h-5" />,
  };
  return iconMap[iconId] || <FolderOpen className="w-5 h-5" />;
}

// 风险确认弹窗组件
function RiskConfirmModal({
  isOpen,
  folder,
  onConfirm,
  onCancel,
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
                color: isSystemFolder ? 'var(--color-danger)' : 'var(--color-warning)',
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
              <p style={{ marginBottom: '8px' }}>迁移前请确保：</p>
              <ul style={{ paddingLeft: '20px' }}>
                <li>已关闭 {folder.display_name} 应用程序</li>
                <li>目标磁盘有足够的可用空间</li>
              </ul>
            </div>
          )}
        </div>

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
  onOpenFolder,
  onRemove,
  isMigrating,
  isRestoring,
}: {
  folder: LargeFolder;
  onMigrate: (folder: LargeFolder) => void;
  onRestore: (folder: LargeFolder) => void;
  onOpenFolder: (path: string) => void;
  onRemove?: (folder: LargeFolder) => void;
  isMigrating?: boolean;
  isRestoring?: boolean;
}) {
  const isSystem = folder.folder_type === 'System';
  const isCustom = folder.folder_type === 'Custom';
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
          {isCustom && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-500/10 text-blue-600">
              自定义
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

      {/* 大小（异步加载） */}
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

        {isCustom && !folder.is_junction && onRemove && (
          <button
            onClick={() => onRemove(folder)}
            className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title="移除"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {notFound ? (
          <button disabled className="h-7 px-3 text-[12px] font-medium rounded-md bg-[var(--bg-hover)] text-[var(--text-muted)] opacity-45 cursor-not-allowed">
            不可用
          </button>
        ) : folder.is_junction ? (
          <button
            onClick={() => onRestore(folder)}
            disabled={isRestoring}
            className="h-7 px-3 text-[12px] font-medium rounded-md bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--color-primary)] transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {isRestoring ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Undo2 className="w-3.5 h-3.5" />
            )}
            {isRestoring ? '恢复中' : '恢复'}
          </button>
        ) : (
          <button
            onClick={() => onMigrate(folder)}
            disabled={isMigrating}
            className="h-7 px-3 text-[12px] font-semibold rounded-md text-white hover:opacity-90 transition-opacity inline-flex items-center gap-1.5 disabled:opacity-60"
            style={{ background: 'var(--color-primary)' }}
          >
            {isMigrating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : null}
            {isMigrating ? '迁移中' : '迁移'}
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

  const { toast, showToast, hideToast } = useToast();

  // 正在迁移/恢复的文件夹 ID，用于按钮 loading 态
  const [migratingFolderId, setMigratingFolderId] = useState<string | null>(null);
  const [restoringFolderId, setRestoringFolderId] = useState<string | null>(null);

  const totalReclaimable = useMemo(() => {
    return folders
      .filter(f => !f.is_junction && f.exists)
      .reduce((sum, f) => sum + f.size, 0);
  }, [folders]);

  const migratedCount = useMemo(() => {
    return folders.filter(f => f.is_junction).length;
  }, [folders]);

  const fetchFolders = useCallback(async () => {
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
  }, [showToast]);

  // 注册大小更新事件监听
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    async function setupListener() {
      try {
        unlisten = await listen<LargeFolderSizeEvent>('large-folder-size', (event) => {
          const { folder_id, size } = event.payload;
          setFolders((prev) =>
            prev.map((f) =>
              f.id === folder_id ? { ...f, size } : f
            )
          );
        });
      } catch (error) {
        console.error('注册大小更新事件失败:', error);
      }
    }

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // 监听迁移完成事件
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    async function setup() {
      try {
        unlisten = await listen<LargeFolderMigrationCompleteEvent>(
          'large-folder-migration-complete',
          (event) => {
            const { success, message } = event.payload;
            setMigratingFolderId(null);
            if (success) {
              showToast(message, 'success');
              fetchFolders();
            } else {
              showToast(message, 'error');
            }
          }
        );
      } catch (error) {
        console.error('注册迁移完成事件失败:', error);
      }
    }
    setup();
    return () => { if (unlisten) unlisten(); };
  }, [showToast, fetchFolders]);

  // 监听恢复完成事件
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    async function setup() {
      try {
        unlisten = await listen<LargeFolderRestoreCompleteEvent>(
          'large-folder-restore-complete',
          (event) => {
            const { success, message } = event.payload;
            setRestoringFolderId(null);
            if (success) {
              showToast(message, 'success');
              fetchFolders();
            } else {
              showToast(message, 'error');
            }
          }
        );
      } catch (error) {
        console.error('注册恢复完成事件失败:', error);
      }
    }
    setup();
    return () => { if (unlisten) unlisten(); };
  }, [showToast, fetchFolders]);

  // 初始加载
  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

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

  // 迁移流程（含进程预检 — 系统文件夹也做检查）
  async function handleMigrate(folder: LargeFolder) {
    // 检查进程锁
    try {
      const lockResult = await invoke<ProcessLockResult>('check_process_locks', {
        sourcePath: folder.path,
      });

      if (lockResult.is_locked) {
        const isSystem = folder.folder_type === 'System';
        const warnMsg = isSystem
          ? `以下系统进程正在使用 "${folder.display_name}"：\n${lockResult.processes.join(', ')}\n\n强制迁移可能导致系统不稳定，是否继续？`
          : `请先关闭以下程序: ${lockResult.processes.join(', ')}`;

        if (isSystem) {
          const proceed = await confirm(warnMsg, {
            title: '系统文件夹进程占用警告',
            kind: 'warning',
            okLabel: '强制继续',
            cancelLabel: '取消',
          });
          if (!proceed) return;
        } else {
          showToast(warnMsg, 'error');
          return;
        }
      }
    } catch (error) {
      console.error('检查进程锁失败:', error);
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
    setMigratingFolderId(folder.id);
    showToast(`正在迁移 ${folder.display_name}...`, 'info');

    try {
      // 迁移在后台线程执行，完成后通过 "large-folder-migration-complete" 事件通知
      await invoke('migrate_large_folder', {
        sourcePath: folder.path,
        targetDir,
      });
    } catch (error) {
      setMigratingFolderId(null);
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
          sourcePath: folder.path,
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

    setRestoringFolderId(folder.id);
    showToast(`正在恢复 ${folder.display_name}...`, 'info');

    try {
      // 恢复在后台线程执行，完成后通过 "large-folder-restore-complete" 事件通知
      await invoke('restore_large_folder', {
        junctionPath: folder.path,
      });
    } catch (error) {
      setRestoringFolderId(null);
      console.error('恢复失败:', error);
      showToast(`恢复失败: ${error}`, 'error');
    }
  }

  // 添加自定义文件夹
  async function handleAddCustomFolder() {
    const selectedPath = await open({
      directory: true,
      title: '选择要监控的文件夹',
    });

    if (!selectedPath) return;

    try {
      await invoke('add_custom_folder', { path: selectedPath as string });
      showToast('文件夹已添加', 'success');
      await fetchFolders();
    } catch (error) {
      showToast(`添加失败: ${error}`, 'error');
    }
  }

  // 移除自定义文件夹
  async function handleRemoveCustomFolder(folder: LargeFolder) {
    try {
      await invoke('remove_custom_folder', { id: folder.id });
      showToast(`已移除 "${folder.display_name}"`, 'success');
      await fetchFolders();
    } catch (error) {
      showToast(`移除失败: ${error}`, 'error');
    }
  }

  // 分组：系统文件夹、应用数据、自定义
  const systemFolders = folders.filter(f => f.folder_type === 'System');
  const appDataFolders = folders.filter(f => f.folder_type === 'AppData');
  const customFolders = folders.filter(f => f.folder_type === 'Custom');

  return (
    <div className="h-full overflow-hidden flex flex-col px-5 py-4">
      <div className="h-full max-w-5xl mx-auto flex flex-col w-full gap-3">
        {/* 顶部统计 + 操作按钮 */}
        <header className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)]">
              <FolderOpen className="w-4 h-4 text-[var(--color-primary)]" />
              <div>
                <div className="text-[10px] text-[var(--text-muted)]">可释放空间</div>
                <div className="text-[15px] font-bold text-[var(--color-primary)] leading-tight">
                  {loading ? '...' : formatSize(totalReclaimable)}
                </div>
              </div>
            </div>

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

          <div className="flex items-center gap-2">
            <button
              onClick={handleAddCustomFolder}
              className="h-8 px-3 text-[12px] font-medium rounded-md border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              添加文件夹
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="h-8 px-3 text-[12px] font-medium rounded-md border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
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
                        isMigrating={migratingFolderId === folder.id}
                        isRestoring={restoringFolderId === folder.id}
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
                        isMigrating={migratingFolderId === folder.id}
                        isRestoring={restoringFolderId === folder.id}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* 自定义文件夹 */}
              {customFolders.length > 0 && (
                <section>
                  <h2 className="text-[13px] font-semibold text-[var(--text-primary)] mb-2">自定义文件夹</h2>
                  <div className="space-y-2">
                    {customFolders.map((folder) => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        onMigrate={handleMigrate}
                        onRestore={handleRestore}
                        onOpenFolder={openFolder}
                        onRemove={handleRemoveCustomFolder}
                        isMigrating={migratingFolderId === folder.id}
                        isRestoring={restoringFolderId === folder.id}
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
