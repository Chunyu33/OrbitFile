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

// 历史记录行组件（紧凑水平布局）
// 
// 布局结构：[图标] [名称+类型] [路径: 原 → 目标] [状态图标] [大小] [恢复按钮]
// 使用 flex 布局，各部分通过 flex-shrink-0 或 min-w-0 控制伸缩
function HistoryRow({ 
  record, 
  onRestore, 
  isRestoring,
  linkStatus,
}: { 
  record: MigrationRecord; 
  onRestore: (id: string, recordType: string) => void;
  isRestoring: boolean;
  linkStatus: LinkStatus;
}) {
  // 判断记录类型（兼容旧数据，默认为 App）
  const isLargeFolder = record.record_type === 'LargeFolder';
  const iconBgColor = isLargeFolder ? 'var(--color-warning)' : 'var(--color-primary)';
  
  return (
    <div 
      className="flex items-center"
      style={{ 
        padding: '12px 16px',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        gap: '12px',
        // 链接损坏时显示警告边框
        borderColor: linkStatus === 'broken' ? 'var(--color-danger)' : 'var(--border-color)',
      }}
    >
      {/* 图标 - 固定宽度 */}
      <div 
        className="flex-shrink-0 flex items-center justify-center"
        style={{ 
          width: '32px',
          height: '32px',
          borderRadius: 'var(--radius-md)',
          background: iconBgColor,
        }}
      >
        {isLargeFolder ? (
          <FolderArchive className="w-4 h-4" style={{ color: 'white' }} />
        ) : (
          <AppWindow className="w-4 h-4" style={{ color: 'white' }} />
        )}
      </div>

      {/* 名称和类型 - 固定宽度 */}
      <div className="flex-shrink-0" style={{ width: '120px' }}>
        <div className="flex items-center" style={{ gap: '6px' }}>
          <span 
            className="truncate"
            style={{ 
              fontSize: '13px', 
              fontWeight: 600, 
              color: 'var(--text-primary)',
              maxWidth: '80px',
            }}
            title={record.app_name}
          >
            {record.app_name}
          </span>
          <span 
            style={{ 
              fontSize: '10px', 
              padding: '1px 4px', 
              borderRadius: '3px',
              background: isLargeFolder ? 'var(--color-warning-light)' : 'var(--color-primary-light)',
              color: isLargeFolder ? 'var(--color-warning)' : 'var(--color-primary)',
              flexShrink: 0,
            }}
          >
            {isLargeFolder ? '文件夹' : '应用'}
          </span>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {formatDate(record.migrated_at)}
        </p>
      </div>

      {/* 路径信息 - 弹性宽度，单行显示 */}
      <div 
        className="flex-1 min-w-0 flex items-center"
        style={{ gap: '6px', fontSize: '12px', color: 'var(--text-tertiary)' }}
      >
        <span 
          className="truncate" 
          style={{ maxWidth: '40%' }}
          title={record.original_path}
        >
          {shortenPath(record.original_path)}
        </span>
        <ArrowRight className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-success)' }} />
        <span 
          className="truncate"
          style={{ maxWidth: '40%' }}
          title={record.target_path}
        >
          {shortenPath(record.target_path)}
        </span>
      </div>

      {/* 健康状态图标 */}
      <div className="flex-shrink-0" style={{ width: '20px' }} title={
        linkStatus === 'healthy' ? '链接正常' : 
        linkStatus === 'broken' ? '目标路径不存在' : ''
      }>
        {linkStatus === 'checking' && (
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
        )}
        {linkStatus === 'healthy' && (
          <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
        )}
        {linkStatus === 'broken' && (
          <AlertTriangle className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
        )}
      </div>

      {/* 大小 - 固定宽度 */}
      <div 
        className="flex-shrink-0 text-right"
        style={{ width: '70px', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}
      >
        {formatSize(record.size)}
      </div>

      {/* 恢复按钮 - 图标按钮 */}
      <button
        onClick={() => onRestore(record.id, record.record_type || 'App')}
        disabled={isRestoring}
        className="btn btn-icon btn-secondary flex-shrink-0"
        title="恢复到原位置"
        style={{ width: '32px', height: '32px' }}
      >
        {isRestoring ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <RotateCcw className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}

// 空状态组件
function EmptyState() {
  return (
    <div className="empty-state flex-1">
      <div className="empty-state-icon">
        <History className="w-8 h-8" />
      </div>
      <p className="empty-state-title">暂无迁移记录</p>
      <p className="empty-state-desc">完成应用迁移后，记录将显示在这里</p>
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
    <div className="h-full overflow-hidden flex flex-col" style={{ padding: 'var(--spacing-4) var(--spacing-5)' }}>
      <div className="h-full max-w-6xl mx-auto flex flex-col w-full" style={{ gap: 'var(--spacing-3)' }}>
        {/* 顶部：标题 + 统计 + 刷新按钮（紧凑单行） */}
        <header className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center" style={{ gap: 'var(--spacing-4)' }}>
            <h1 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text-primary)' }}>
              迁移历史
            </h1>
            {/* 内联统计信息 */}
            {records.length > 0 && (
              <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
                <span className="badge badge-primary">
                  <History className="w-3 h-3" />
                  {records.length} 项
                </span>
                <span className="badge badge-success">
                  <HardDrive className="w-3 h-3" />
                  已释放 {formatSize(totalSize)}
                </span>
                {brokenCount > 0 && (
                  <span className="badge" style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}>
                    <AlertTriangle className="w-3 h-3" />
                    {brokenCount} 个异常
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={loadHistory}
            disabled={loading}
            className="btn btn-secondary"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </header>

        {/* 内容区 - 使用单列列表布局 */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center" style={{ gap: 'var(--spacing-3)' }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--color-primary)' }} />
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)' }}>加载中...</span>
          </div>
        ) : records.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ paddingRight: 'var(--spacing-2)' }}>
            <div className="flex flex-col" style={{ gap: '8px', paddingBottom: 'var(--spacing-4)' }}>
              {records.map((record) => (
                <HistoryRow
                  key={record.id}
                  record={record}
                  onRestore={handleRestore}
                  isRestoring={restoringId === record.id}
                  linkStatus={linkStatuses[record.id] || 'unknown'}
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
