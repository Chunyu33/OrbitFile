// 迁移历史页面
// 企业级模块化设计
// 
// UI 压缩策略说明：
// 1. 使用水平行布局替代垂直卡片，单行显示所有信息
// 2. 路径使用单行显示 (原路径 → 目标路径)，通过 truncate 类截断过长路径
// 3. 图标尺寸从 40px 缩小到 32px，减少视觉占用
// 4. 移除路径区域的背景色和内边距，直接内联显示
// 5. 恢复按钮改为右侧图标按钮，节省水平空间
// 6. 使用 flex 布局的 gap 控制间距，避免使用 margin

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { 
  History, RotateCcw, HardDrive, RefreshCw, Loader2, 
  FolderArchive, AppWindow, ArrowRight, CheckCircle2, AlertTriangle 
} from 'lucide-react';
import { MigrationRecord, MigrationResult } from '../types';
import Toast, { useToast } from '../components/Toast';

// 链接健康状态类型
type LinkStatus = 'checking' | 'healthy' | 'broken' | 'unknown';

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes === 0) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// 格式化日期（紧凑格式）
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 截取路径显示（保留盘符和最后一级目录）
function shortenPath(path: string): string {
  if (path.length <= 30) return path;
  const parts = path.split('\\');
  if (parts.length <= 2) return path;
  // 保留盘符和最后两级目录
  return `${parts[0]}\\...\\${parts.slice(-2).join('\\')}`;
}

// 历史记录行组件
function HistoryRow({ 
  record, 
  onRestore, 
  isRestoring,
  linkStatus,
  isLast,
}: { 
  record: MigrationRecord; 
  onRestore: (id: string, recordType: string) => void;
  isRestoring: boolean;
  linkStatus: LinkStatus;
  isLast: boolean;
}) {
  const isLargeFolder = record.record_type === 'LargeFolder';

  return (
    <div className={`
      group relative rounded-xl border bg-[var(--bg-card)] px-4 py-3
      transition-all duration-200 hover:-translate-y-[1px]
      ${linkStatus === 'broken'
        ? 'border-red-200 bg-red-50/50 dark:bg-red-900/10'
        : 'border-[var(--border-color)] hover:border-[var(--border-color-hover)]'
      }
      ${!isLast ? '' : ''}
    `}>
      <div className="flex items-center gap-3">
      {/* 图标 */}
      <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-white shadow-sm ${isLargeFolder ? 'bg-amber-500' : 'bg-[var(--color-primary)]'}`}>
        {isLargeFolder
          ? <FolderArchive className="w-4 h-4" />
          : <AppWindow className="w-4 h-4" />
        }
      </div>

      {/* 名称 + 类型 + 日期 */}
      <div className="flex-shrink-0 w-32">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate max-w-[90px]" title={record.app_name}>
            {record.app_name}
          </span>
          <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded-full flex-shrink-0 ${isLargeFolder ? 'bg-amber-500/10 text-amber-600' : 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'}`}>
            {isLargeFolder ? '文件夹' : '应用'}
          </span>
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{formatDate(record.migrated_at)}</p>
      </div>

      {/* 路径 */}
      <div className="flex-1 min-w-0 flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
        <span className="truncate px-2 py-1 rounded-md bg-[var(--bg-hover)]/70" style={{ maxWidth: '40%' }} title={record.original_path}>
          {shortenPath(record.original_path)}
        </span>
        <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 text-emerald-500" />
        <span className="truncate px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" style={{ maxWidth: '40%' }} title={record.target_path}>
          {shortenPath(record.target_path)}
        </span>
      </div>

      {/* 链接健康状态 */}
      <div className="flex-shrink-0 w-5" title={linkStatus === 'healthy' ? '链接正常' : linkStatus === 'broken' ? '目标路径不存在' : ''}>
        {linkStatus === 'checking' && <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />}
        {linkStatus === 'healthy' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
        {linkStatus === 'broken' && <AlertTriangle className="w-4 h-4 text-red-500" />}
      </div>

      {/* 大小 */}
      <div className="flex-shrink-0">
        <div className="h-7 px-2.5 rounded-full bg-[var(--bg-hover)] border border-[var(--border-color)] inline-flex items-center">
          <span className="text-[11px] font-semibold text-[var(--text-primary)] tabular-nums">
            {formatSize(record.size)}
          </span>
        </div>
      </div>

      {/* 恢复按钮 */}
      <button
        onClick={() => onRestore(record.id, record.record_type || 'App')}
        disabled={isRestoring}
        className="flex-shrink-0 h-8 w-8 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] hover:bg-[var(--bg-hover)] transition-colors inline-flex items-center justify-center disabled:opacity-50"
        title="恢复到原位置"
      >
        {isRestoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
      </button>
      </div>
    </div>
  );
}

// 空状态组件
function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[var(--bg-hover)] flex items-center justify-center mb-3 shadow-sm">
        <History className="w-5 h-5 text-[var(--text-muted)]" />
      </div>
      <p className="text-[14px] font-medium text-[var(--text-primary)] mb-1">暂无迁移记录</p>
      <p className="text-[12px] text-[var(--text-tertiary)]">完成应用迁移后，记录将显示在这里</p>
    </div>
  );
}

export default function MigrationHistory() {
  const [records, setRecords] = useState<MigrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // 链接健康状态映射表：记录ID -> 状态
  const [linkStatuses, setLinkStatuses] = useState<Record<string, LinkStatus>>({});
  const { toast, showToast, hideToast } = useToast();

  // 加载历史记录
  async function loadHistory() {
    try {
      setLoading(true);
      const history = await invoke<MigrationRecord[]>('get_migration_history');
      setRecords(history);
      
      // 异步检查每条记录的链接健康状态（不阻塞 UI 渲染）
      // 先将所有状态设为 checking
      const initialStatuses: Record<string, LinkStatus> = {};
      history.forEach(r => { initialStatuses[r.id] = 'checking'; });
      setLinkStatuses(initialStatuses);
      
      // 逐个检查链接状态（异步，不阻塞）
      history.forEach(async (record) => {
        try {
          const result = await invoke<{ healthy: boolean; target_exists: boolean }>('check_link_status', { 
            recordId: record.id 
          });
          setLinkStatuses(prev => ({
            ...prev,
            [record.id]: result.healthy ? 'healthy' : 'broken'
          }));
        } catch {
          // 检查失败时标记为未知状态
          setLinkStatuses(prev => ({
            ...prev,
            [record.id]: 'unknown'
          }));
        }
      });
    } catch (error) {
      console.error('加载历史记录失败:', error);
      showToast('加载历史记录失败', 'error');
    } finally {
      setLoading(false);
    }
  }

  // 恢复应用或文件夹
  async function handleRestore(historyId: string, recordType: string) {
    try {
      setRestoringId(historyId);
      
      // 根据记录类型调用不同的恢复命令
      const record = records.find(r => r.id === historyId);
      let result: MigrationResult;
      
      if (recordType === 'LargeFolder' && record) {
        // 大文件夹恢复：使用原始路径调用 restore_large_folder
        result = await invoke<MigrationResult>('restore_large_folder', { 
          junctionPath: record.original_path 
        });
      } else {
        // 应用恢复：使用历史记录 ID 调用 restore_app
        result = await invoke<MigrationResult>('restore_app', { historyId });
      }
      
      if (result.success) {
        showToast(recordType === 'LargeFolder' ? '文件夹已成功恢复到原位置' : '应用已成功恢复到原位置', 'success');
        // 重新加载历史记录
        await loadHistory();
      } else {
        showToast(result.message, 'error');
      }
    } catch (error) {
      showToast(`恢复失败: ${error}`, 'error');
    } finally {
      setRestoringId(null);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  // 计算统计信息
  const totalSize = records.reduce((sum, r) => sum + r.size, 0);
  // 统计损坏的链接数量
  const brokenCount = Object.values(linkStatuses).filter(s => s === 'broken').length;

  return (
    <div className="h-full overflow-hidden flex flex-col px-5 py-4">
      <div className="h-full max-w-6xl mx-auto flex flex-col w-full gap-4">
        {/* 顶部：统计 + 刷新 */}
        <header className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            {records.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-card)] text-[12px] shadow-sm">
                  <History className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                  <span className="font-semibold text-[var(--text-primary)]">{records.length}</span>
                  <span className="text-[var(--text-muted)]">项记录</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-card)] text-[12px] shadow-sm">
                  <HardDrive className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="font-semibold text-[var(--text-primary)]">{formatSize(totalSize)}</span>
                  <span className="text-[var(--text-muted)]">已释放</span>
                </div>
                {brokenCount > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-red-200 bg-red-50 text-[12px] text-red-600 shadow-sm dark:bg-red-900/20 dark:border-red-900/60 dark:text-red-300">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span className="font-semibold">{brokenCount} 个异常</span>
                  </div>
                )}
              </>
            )}
          </div>
          <button
            onClick={loadHistory}
            disabled={loading}
            className="h-8 px-3 text-[12px] font-medium rounded-md border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </header>

        {/* 内容区 */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
            <span className="text-[13px]">加载中...</span>
          </div>
        ) : records.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-2 pb-2">
              {records.map((record, index) => (
                <HistoryRow
                  key={record.id}
                  record={record}
                  onRestore={handleRestore}
                  isRestoring={restoringId === record.id}
                  linkStatus={linkStatuses[record.id] || 'unknown'}
                  isLast={index === records.length - 1}
                />
              ))}
            </div>
          </div>
        )}
      </div>

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
