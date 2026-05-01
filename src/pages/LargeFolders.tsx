// 数据迁移页面 — 桌面工具风格
// 紧凑行布局，弱化操作视觉

import { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import {
  RefreshCw, FolderOpen, AlertTriangle,
  Link2, Undo2, Plus, X, Loader2,
  Monitor, FileText, Download, Image, Video,
  MessageCircle, Building2, Users, Phone, Bird, Globe, Code, Package,
} from 'lucide-react';
import Toast, { useToast } from '../components/Toast';
import {
  LargeFolder, ProcessLockResult, LargeFolderSizeEvent,
  LargeFolderMigrationCompleteEvent, LargeFolderRestoreCompleteEvent,
} from '../types';

function formatSize(bytes: number): string {
  if (bytes === 0) return '--';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFolderIcon(iconId: string) {
  const map: Record<string, React.ReactNode> = {
    desktop: <Monitor className="w-4 h-4" />,
    documents: <FileText className="w-4 h-4" />,
    downloads: <Download className="w-4 h-4" />,
    pictures: <Image className="w-4 h-4" />,
    videos: <Video className="w-4 h-4" />,
    wechat: <MessageCircle className="w-4 h-4" />,
    wxwork: <Building2 className="w-4 h-4" />,
    qq: <Users className="w-4 h-4" />,
    dingtalk: <Phone className="w-4 h-4" />,
    feishu: <Bird className="w-4 h-4" />,
    chrome_cache: <Globe className="w-4 h-4" />,
    edge_cache: <Globe className="w-4 h-4" />,
    vscode_extensions: <Code className="w-4 h-4" />,
    npm_global: <Package className="w-4 h-4" />,
  };
  return map[iconId] || <FolderOpen className="w-4 h-4" />;
}

function RiskConfirmModal({
  isOpen, folder, onConfirm, onCancel,
}: {
  isOpen: boolean; folder: LargeFolder | null; onConfirm: () => void; onCancel: () => void;
}) {
  if (!isOpen || !folder) return null;
  const isSystem = folder.folder_type === 'System';

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center" style={{ background: 'var(--bg-modal-overlay)' }}>
      <div className="animate-modal-in rounded-lg p-6 w-[440px]" style={{ background: 'var(--bg-modal)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: isSystem ? 'var(--color-danger-light)' : 'var(--color-warning-light)' }}>
            <AlertTriangle className="w-5 h-5" style={{ color: isSystem ? 'var(--color-danger)' : 'var(--color-warning)' }} />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {isSystem ? '高风险操作' : '确认迁移'}
            </h3>
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {folder.display_name} — {formatSize(folder.size)}
            </p>
          </div>
        </div>

        <div className="mb-5 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {isSystem ? (
            <>
              <p className="mb-2">迁移系统文件夹 <strong>{folder.display_name}</strong> 可能导致：</p>
              <ul className="list-disc pl-4 mb-2">
                <li>部分应用无法正常访问该文件夹</li>
                <li>Windows 系统功能异常</li>
                <li>OneDrive 等服务出现问题</li>
              </ul>
            </>
          ) : (
            <>
              <p className="mb-2">即将迁移 <strong>{folder.display_name}</strong>。</p>
              <ul className="list-disc pl-4">
                <li>请确认已关闭相关应用</li>
                <li>目标磁盘需有足够空间</li>
              </ul>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn h-7 text-[12px]">取消</button>
          <button onClick={onConfirm} className="btn btn-danger h-7 text-[12px]">
            {isSystem ? '我了解风险，继续' : '确认迁移'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FolderRow({
  folder, onMigrate, onRestore, onOpenFolder, onRemove,
  isMigrating, isRestoring,
}: {
  folder: LargeFolder;
  onMigrate: (f: LargeFolder) => void;
  onRestore: (f: LargeFolder) => void;
  onOpenFolder: (path: string) => void;
  onRemove?: (f: LargeFolder) => void;
  isMigrating?: boolean;
  isRestoring?: boolean;
}) {
  const notFound = !folder.exists;
  const isSystem = folder.folder_type === 'System';
  const isCustom = folder.folder_type === 'Custom';

  const rowStyle: React.CSSProperties = {
    height: 'var(--row-height)' as unknown as string,
    padding: '0 8px',
    borderBottom: '1px solid var(--border-color)',
    opacity: notFound ? 0.4 : 1,
  } as React.CSSProperties;

  return (
    <div
      className="flex items-center gap-3"
      style={rowStyle}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-row-hover)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {/* icon */}
      <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
        {getFolderIcon(folder.icon_id)}
      </div>

      {/* info */}
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)', maxWidth: '200px' }}>
          {folder.display_name}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {notFound && <span className="badge" style={{ color: 'var(--text-tertiary)' }}>未检测到</span>}
          {!notFound && isSystem && !folder.is_junction && (
            <span className="badge" style={{ color: 'var(--color-warning)', background: 'var(--color-warning-light)' }}>系统</span>
          )}
          {isCustom && <span className="badge badge-primary">自定义</span>}
          {folder.is_junction && <span className="badge badge-success"><Link2 className="w-2.5 h-2.5" />已迁移</span>}
        </div>
        <span className="text-[11px] truncate flex-1 min-w-0" style={{ color: 'var(--text-tertiary)' }} title={folder.path}>
          {folder.is_junction && folder.junction_target
            ? `→ ${folder.junction_target}`
            : notFound ? `默认: ${folder.path}` : folder.path}
        </span>
      </div>

      {/* size */}
      <span className="text-[11px] tabular-nums flex-shrink-0 w-20 text-right" style={{ color: 'var(--text-secondary)' }}>
        {notFound ? '--' : folder.is_junction ? '--' : formatSize(folder.size)}
      </span>

      {/* actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {!notFound && (
          <button onClick={() => onOpenFolder(folder.path)} className="btn btn-ghost btn-icon" title="打开目录">
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        )}
        {isCustom && !folder.is_junction && onRemove && (
          <button onClick={() => onRemove(folder)} className="btn btn-ghost btn-icon" title="移除">
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {notFound ? (
          <span className="text-[11px] mr-2" style={{ color: 'var(--text-tertiary)' }}>不可用</span>
        ) : folder.is_junction ? (
          <button onClick={() => onRestore(folder)} disabled={isRestoring} className="btn btn-sm h-6 text-[11px]">
            {isRestoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
            {isRestoring ? '恢复中' : '恢复'}
          </button>
        ) : (
          <button onClick={() => onMigrate(folder)} disabled={isMigrating} className="btn btn-primary btn-sm h-6 text-[11px]">
            {isMigrating ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
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
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean; folder: LargeFolder | null; targetDir: string | null;
  }>({ isOpen: false, folder: null, targetDir: null });
  const [migratingFolderId, setMigratingFolderId] = useState<string | null>(null);
  const [restoringFolderId, setRestoringFolderId] = useState<string | null>(null);

  const { toast, showToast, hideToast } = useToast();

  const totalReclaimable = useMemo(
    () => folders.filter(f => !f.is_junction && f.exists).reduce((s, f) => s + f.size, 0),
    [folders],
  );
  const migratedCount = useMemo(() => folders.filter(f => f.is_junction).length, [folders]);

  const fetchFolders = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<LargeFolder[]>('get_large_folders');
      setFolders(result);
    } catch (error) {
      console.error('获取大文件夹列表失败:', error);
      showToast('获取文件夹列表失败', 'error');
    } finally { setLoading(false); }
  }, [showToast]);

  // size update events
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    (async () => {
      try {
        unlisten = await listen<LargeFolderSizeEvent>('large-folder-size', (event) => {
          const { folder_id, size } = event.payload;
          setFolders(prev => prev.map(f => f.id === folder_id ? { ...f, size } : f));
        });
      } catch { /* ignore */ }
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // migration complete events
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    (async () => {
      try {
        unlisten = await listen<LargeFolderMigrationCompleteEvent>('large-folder-migration-complete', (event) => {
          const { success, message } = event.payload;
          setMigratingFolderId(null);
          if (success) { showToast(message, 'success'); fetchFolders(); }
          else { showToast(message, 'error'); }
        });
      } catch { /* ignore */ }
    })();
    return () => { if (unlisten) unlisten(); };
  }, [showToast, fetchFolders]);

  // restore complete events
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    (async () => {
      try {
        unlisten = await listen<LargeFolderRestoreCompleteEvent>('large-folder-restore-complete', (event) => {
          const { success, message } = event.payload;
          setRestoringFolderId(null);
          if (success) { showToast(message, 'success'); fetchFolders(); }
          else { showToast(message, 'error'); }
        });
      } catch { /* ignore */ }
    })();
    return () => { if (unlisten) unlisten(); };
  }, [showToast, fetchFolders]);

  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  async function handleRefresh() { setRefreshing(true); await fetchFolders(); setRefreshing(false); }

  async function openFolder(path: string) {
    try { await invoke('open_folder', { path }); }
    catch (error) { console.error('打开文件夹失败:', error); showToast('打开文件夹失败', 'error'); }
  }

  async function handleMigrate(folder: LargeFolder) {
    try {
      const lockResult = await invoke<ProcessLockResult>('check_process_locks', { sourcePath: folder.path });
      if (lockResult.is_locked) {
        const isSystem = folder.folder_type === 'System';
        if (isSystem) {
          const proceed = await confirm(
            `以下系统进程正在使用 "${folder.display_name}"：\n${lockResult.processes.join(', ')}\n\n强制继续？`,
            { title: '进程占用警告', kind: 'warning', okLabel: '强制继续', cancelLabel: '取消' }
          );
          if (!proceed) return;
        } else {
          showToast(`请先关闭: ${lockResult.processes.join(', ')}`, 'error');
          return;
        }
      }
    } catch { /* non-critical */ }

    const targetDir = await open({ directory: true, title: `选择 "${folder.display_name}" 的迁移目标位置` });
    if (!targetDir) return;

    setConfirmModal({ isOpen: true, folder, targetDir: targetDir as string });
  }

  async function confirmMigrate() {
    const { folder, targetDir } = confirmModal;
    if (!folder || !targetDir) return;
    setConfirmModal({ isOpen: false, folder: null, targetDir: null });
    setMigratingFolderId(folder.id);
    showToast(`正在迁移 ${folder.display_name}...`, 'info');

    try {
      await invoke('migrate_large_folder', { sourcePath: folder.path, targetDir });
    } catch (error) {
      setMigratingFolderId(null);
      showToast(`迁移失败: ${error}`, 'error');
    }
  }

  async function handleRestore(folder: LargeFolder) {
    if (folder.app_process_names.length > 0) {
      try {
        const lockResult = await invoke<ProcessLockResult>('check_process_locks', { sourcePath: folder.path });
        if (lockResult.is_locked) {
          showToast(`请先关闭: ${lockResult.processes.join(', ')}`, 'error');
          return;
        }
      } catch { /* non-critical */ }
    }
    setRestoringFolderId(folder.id);
    showToast(`正在恢复 ${folder.display_name}...`, 'info');
    try {
      await invoke('restore_large_folder', { junctionPath: folder.path });
    } catch (error) {
      setRestoringFolderId(null);
      showToast(`恢复失败: ${error}`, 'error');
    }
  }

  async function handleAddCustomFolder() {
    const selectedPath = await open({ directory: true, title: '选择要监控的文件夹' });
    if (!selectedPath) return;
    try {
      await invoke('add_custom_folder', { path: selectedPath as string });
      showToast('文件夹已添加', 'success');
      await fetchFolders();
    } catch (error) { showToast(`添加失败: ${error}`, 'error'); }
  }

  async function handleRemoveCustomFolder(folder: LargeFolder) {
    try {
      await invoke('remove_custom_folder', { id: folder.id });
      showToast(`已移除 "${folder.display_name}"`, 'success');
      await fetchFolders();
    } catch (error) { showToast(`移除失败: ${error}`, 'error'); }
  }

  const systemFolders = folders.filter(f => f.folder_type === 'System');
  const appDataFolders = folders.filter(f => f.folder_type === 'AppData');
  const customFolders = folders.filter(f => f.folder_type === 'Custom');

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ padding: '12px 16px' }}>
      <div className="h-full flex flex-col w-full gap-3">
        {/* top stats + actions */}
        <div className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4 text-[12px]">
            <span style={{ color: 'var(--text-secondary)' }}>
              可释放 <strong style={{ color: 'var(--text-primary)' }}>{loading ? '...' : formatSize(totalReclaimable)}</strong>
            </span>
            {migratedCount > 0 && (
              <span style={{ color: 'var(--text-secondary)' }}>
                已迁移 <strong style={{ color: 'var(--color-success)' }}>{migratedCount}</strong> 个
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleAddCustomFolder} className="btn h-7 text-[12px]">
              <Plus className="w-3.5 h-3.5" />
              添加文件夹
            </button>
            <button onClick={handleRefresh} disabled={refreshing} className="btn h-7 text-[12px]">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        </div>

        {/* content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="flex items-center gap-3 animate-pulse" style={{ height: 'var(--row-height)', padding: '0 8px', borderBottom: '1px solid var(--border-color)' }}>
                  <div className="w-7 h-7 rounded" style={{ background: 'var(--bg-row-hover)' }} />
                  <div className="flex-1 h-3 rounded" style={{ background: 'var(--bg-row-hover)' }} />
                  <div className="w-20 h-3 rounded" style={{ background: 'var(--bg-row-hover)' }} />
                  <div className="w-16 h-7 rounded" style={{ background: 'var(--bg-row-hover)' }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {systemFolders.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-1.5 px-2">
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>系统文件夹</span>
                    <span className="badge" style={{ color: 'var(--color-warning)', background: 'var(--color-warning-light)' }}>
                      <AlertTriangle className="w-3 h-3" />谨慎操作
                    </span>
                  </div>
                  {systemFolders.map(f => (
                    <FolderRow key={f.id} folder={f} onMigrate={handleMigrate} onRestore={handleRestore}
                      onOpenFolder={openFolder} isMigrating={migratingFolderId === f.id} isRestoring={restoringFolderId === f.id} />
                  ))}
                </section>
              )}

              {appDataFolders.length > 0 && (
                <section>
                  <div className="px-2 mb-1.5">
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>应用数据</span>
                  </div>
                  {appDataFolders.map(f => (
                    <FolderRow key={f.id} folder={f} onMigrate={handleMigrate} onRestore={handleRestore}
                      onOpenFolder={openFolder} isMigrating={migratingFolderId === f.id} isRestoring={restoringFolderId === f.id} />
                  ))}
                </section>
              )}

              {customFolders.length > 0 && (
                <section>
                  <div className="px-2 mb-1.5">
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>自定义文件夹</span>
                  </div>
                  {customFolders.map(f => (
                    <FolderRow key={f.id} folder={f} onMigrate={handleMigrate} onRestore={handleRestore}
                      onOpenFolder={openFolder} onRemove={handleRemoveCustomFolder}
                      isMigrating={migratingFolderId === f.id} isRestoring={restoringFolderId === f.id} />
                  ))}
                </section>
              )}

              {folders.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <FolderOpen className="w-6 h-6 mb-2" style={{ color: 'var(--text-tertiary)' }} />
                  <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>未检测到可迁移的文件夹</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <RiskConfirmModal isOpen={confirmModal.isOpen} folder={confirmModal.folder}
        onConfirm={confirmMigrate}
        onCancel={() => setConfirmModal({ isOpen: false, folder: null, targetDir: null })} />

      <Toast message={toast.message} type={toast.type} visible={toast.visible} onClose={hideToast} />
    </div>
  );
}
