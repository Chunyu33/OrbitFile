// 迁移历史页面
// 企业级模块化设计

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { History, RotateCcw, Folder, FolderOutput, HardDrive, RefreshCw, Loader2, FolderArchive, AppWindow } from 'lucide-react';
import { MigrationRecord, MigrationResult } from '../types';
import Toast, { useToast } from '../components/Toast';

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes === 0) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// 格式化日期
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 历史记录卡片组件
function HistoryCard({ 
  record, 
  onRestore, 
  isRestoring 
}: { 
  record: MigrationRecord; 
  onRestore: (id: string, recordType: string) => void;
  isRestoring: boolean;
}) {
  // 判断记录类型（兼容旧数据，默认为 App）
  const isLargeFolder = record.record_type === 'LargeFolder';
  const iconBgColor = isLargeFolder ? 'var(--color-warning)' : 'var(--color-primary)';
  
  return (
    <div className="card card-hover" style={{ padding: 'var(--spacing-5)' }}>
      {/* 名称和时间 */}
      <div className="flex items-start justify-between" style={{ marginBottom: 'var(--spacing-4)' }}>
        <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
          <div 
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: iconBgColor }}
          >
            {isLargeFolder ? (
              <FolderArchive className="w-5 h-5" style={{ color: 'white' }} />
            ) : (
              <AppWindow className="w-5 h-5" style={{ color: 'white' }} />
            )}
          </div>
          <div>
            <div className="flex items-center" style={{ gap: 'var(--spacing-2)' }}>
              <h3 style={{ color: 'var(--text-primary)', fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--font-size-sm)' }}>
                {record.app_name}
              </h3>
              <span 
                style={{ 
                  fontSize: '10px', 
                  padding: '1px 6px', 
                  borderRadius: '4px',
                  background: isLargeFolder ? 'var(--color-warning-light)' : 'var(--color-primary-light)',
                  color: isLargeFolder ? 'var(--color-warning)' : 'var(--color-primary)',
                }}
              >
                {isLargeFolder ? '文件夹' : '应用'}
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', marginTop: '2px' }}>
              {formatDate(record.migrated_at)}
            </p>
          </div>
        </div>
        <span className="badge badge-success">
          <HardDrive className="w-3 h-3" />
          {formatSize(record.size)}
        </span>
      </div>

      {/* 路径信息 */}
      <div 
        style={{ 
          padding: 'var(--spacing-3)', 
          background: 'var(--color-gray-50)', 
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--spacing-4)'
        }}
      >
        <div className="flex items-center" style={{ gap: 'var(--spacing-2)', fontSize: 'var(--font-size-xs)', marginBottom: 'var(--spacing-2)' }}>
          <Folder className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          <span className="truncate" style={{ color: 'var(--text-tertiary)' }} title={record.original_path}>
            {record.original_path}
          </span>
        </div>
        <div className="flex items-center" style={{ gap: 'var(--spacing-2)', fontSize: 'var(--font-size-xs)' }}>
          <FolderOutput className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-success)' }} />
          <span className="truncate" style={{ color: 'var(--text-tertiary)' }} title={record.target_path}>
            {record.target_path}
          </span>
        </div>
      </div>

      {/* 恢复按钮 */}
      <button
        onClick={() => onRestore(record.id, record.record_type || 'App')}
        disabled={isRestoring}
        className="btn btn-secondary w-full"
      >
        {isRestoring ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            恢复中...
          </>
        ) : (
          <>
            <RotateCcw className="w-4 h-4" />
            恢复到原位置
          </>
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
  const { toast, showToast, hideToast } = useToast();

  // 加载历史记录
  async function loadHistory() {
    try {
      setLoading(true);
      const history = await invoke<MigrationRecord[]>('get_migration_history');
      setRecords(history);
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

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ padding: 'var(--spacing-4) var(--spacing-5)' }}>
      <div className="h-full max-w-5xl mx-auto flex flex-col w-full" style={{ gap: 'var(--spacing-3)' }}>
        {/* 顶部：标题 + 统计 + 刷新按钮（紧凑单行） */}
        <header className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center" style={{ gap: 'var(--spacing-6)' }}>
            <h1 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text-primary)' }}>
              迁移历史
            </h1>
            {/* 内联统计信息 */}
            {records.length > 0 && (
              <div className="flex items-center" style={{ gap: 'var(--spacing-4)' }}>
                <span className="badge badge-primary">
                  <History className="w-3 h-3" />
                  {records.length} 项迁移
                </span>
                <span className="badge badge-success">
                  <HardDrive className="w-3 h-3" />
                  已释放 {formatSize(totalSize)}
                </span>
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

        {/* 内容区 */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center" style={{ gap: 'var(--spacing-3)' }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--color-primary)' }} />
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)' }}>加载中...</span>
          </div>
        ) : records.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ paddingRight: 'var(--spacing-2)' }}>
            <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 'var(--spacing-4)', paddingBottom: 'var(--spacing-4)' }}>
              {records.map((record) => (
                <HistoryCard
                  key={record.id}
                  record={record}
                  onRestore={handleRestore}
                  isRestoring={restoringId === record.id}
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
