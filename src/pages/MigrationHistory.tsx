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

import { useEffect, useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  History, RotateCcw, HardDrive, RefreshCw, Loader2,
  FolderArchive, AppWindow, ArrowRight, CheckCircle2, AlertTriangle, Search, ChevronDown, ChevronUp
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

// 健康状态缓存（5 分钟内有效，避免重复 IO）
const HEALTH_CACHE_KEY = 'orbitfile_health_cache';
const HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedHealth {
  status: LinkStatus;
  timestamp: number;
}

function loadHealthCache(): Record<string, CachedHealth> {
  try {
    const raw = localStorage.getItem(HEALTH_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveHealthCache(cache: Record<string, CachedHealth>) {
  try {
    localStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota exceeded, silently ignore */ }
}

function getCachedStatus(recordId: string): LinkStatus | null {
  const cache = loadHealthCache();
  const entry = cache[recordId];
  if (entry && Date.now() - entry.timestamp < HEALTH_CACHE_TTL_MS) {
    return entry.status;
  }
  return null;
}

function setCachedStatus(recordId: string, status: LinkStatus) {
  const cache = loadHealthCache();
  cache[recordId] = { status, timestamp: Date.now() };
  saveHealthCache(cache);
}

// 详细日期格式化
function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// 历史记录行组件
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
  const isLargeFolder = record.record_type === 'LargeFolder';
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`
        group relative rounded-xl bg-[var(--bg-card)] px-4 py-3 cursor-pointer
        transition-all duration-200 hover:-translate-y-[1px]
        shadow-[0_1px_0_rgba(15,23,42,0.04),0_6px_18px_rgba(15,23,42,0.06)]
        hover:shadow-[0_10px_26px_rgba(15,23,42,0.1)]
        dark:shadow-[0_1px_0_rgba(0,0,0,0.28),0_8px_22px_rgba(0,0,0,0.28)]
        dark:hover:shadow-[0_12px_28px_rgba(0,0,0,0.36)]
        ${linkStatus === 'broken'
          ? 'bg-red-50/55 dark:bg-red-900/12'
          : ''
        }
      `}
      onClick={() => setExpanded(!expanded)}
    >
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
        <div className="h-7 px-2.5 rounded-full bg-[var(--bg-hover)]/75 inline-flex items-center">
          <span className="text-[11px] font-semibold text-[var(--text-primary)] tabular-nums">
            {formatSize(record.size)}
          </span>
        </div>
      </div>

      {/* 恢复按钮（阻止冒泡，防止点恢复的同时触发展开） */}
      <button
        onClick={e => { e.stopPropagation(); onRestore(record.id, record.record_type || 'App'); }}
        disabled={isRestoring}
        className="flex-shrink-0 h-8 w-8 rounded-md text-[var(--text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--bg-hover)] transition-colors inline-flex items-center justify-center disabled:opacity-50"
        title="恢复到原位置"
      >
        {isRestoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
      </button>

      {/* 展开/折叠指示器 */}
      <div className="flex-shrink-0 w-4">
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
        }
      </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div
          className="mt-3 pt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[11px]"
          style={{ borderTop: '1px solid var(--border-color)' }}
          onClick={e => e.stopPropagation()}
        >
          <div>
            <span style={{ color: 'var(--text-tertiary)' }}>原路径</span>
            <p className="break-all mt-0.5" style={{ color: 'var(--text-primary)' }}>{record.original_path}</p>
          </div>
          <div>
            <span style={{ color: 'var(--text-tertiary)' }}>目标路径</span>
            <p className="break-all mt-0.5" style={{ color: 'var(--text-primary)' }}>{record.target_path}</p>
          </div>
          <div>
            <span style={{ color: 'var(--text-tertiary)' }}>迁移时间</span>
            <p style={{ color: 'var(--text-primary)' }}>{formatFullDate(record.migrated_at)}</p>
          </div>
          <div>
            <span style={{ color: 'var(--text-tertiary)' }}>记录 ID</span>
            <p className="break-all" style={{ color: 'var(--text-primary)', fontSize: '10px' }}>{record.id}</p>
          </div>
          <div>
            <span style={{ color: 'var(--text-tertiary)' }}>链接状态</span>
            <p style={{
              color: linkStatus === 'healthy' ? 'var(--color-success)'
                : linkStatus === 'broken' ? 'var(--color-danger)'
                : 'var(--text-secondary)'
            }}>
              {linkStatus === 'healthy' ? '正常' : linkStatus === 'broken' ? '损坏' : linkStatus === 'checking' ? '检查中' : '未知'}
            </p>
          </div>
          <div>
            <span style={{ color: 'var(--text-tertiary)' }}>记录大小</span>
            <p style={{ color: 'var(--text-primary)' }}>{formatSize(record.size)}</p>
          </div>
        </div>
      )}
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
  // 搜索、筛选、排序、分页
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'App' | 'LargeFolder'>('all');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'size_desc' | 'size_asc'>('date_desc');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  // 加载历史记录
  async function loadHistory() {
    try {
      setLoading(true);
      const history = await invoke<MigrationRecord[]>('get_migration_history');
      setRecords(history);
      
      // 健康状态缓存：优先读取缓存，仅对无缓存/过期/异常的记录发起网络检查
      const initialStatuses: Record<string, LinkStatus> = {};
      const needCheck: MigrationRecord[] = [];
      for (const r of history) {
        const cached = getCachedStatus(r.id);
        if (cached && cached !== 'checking') {
          initialStatuses[r.id] = cached;
        } else {
          initialStatuses[r.id] = 'checking';
          needCheck.push(r);
        }
      }
      setLinkStatuses(initialStatuses);

      // 并发检查链接健康状态（限制最大 5 个并发，避免 IO 饱和）
      async function runWithConcurrency(
        items: MigrationRecord[],
        limit: number,
        worker: (r: MigrationRecord) => Promise<void>,
      ) {
        const queue = [...items];
        const active: Promise<void>[] = [];
        async function next() {
          while (queue.length > 0) {
            const item = queue.shift()!;
            const p = worker(item);
            active.push(p);
            p.finally(() => { active.splice(active.indexOf(p), 1); });
            if (active.length >= limit) {
              await Promise.race(active);
            }
          }
          await Promise.all(active);
        }
        await next();
      }

      runWithConcurrency(needCheck, 5, async (record) => {
        try {
          const result = await invoke<{ healthy: boolean; target_exists: boolean }>('check_link_status', {
            recordId: record.id
          });
          const status: LinkStatus = result.healthy ? 'healthy' : 'broken';
          setCachedStatus(record.id, status);
          setLinkStatuses(prev => ({
            ...prev,
            [record.id]: status
          }));
        } catch {
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

  // 搜索、筛选、排序后的记录列表
  const filteredRecords = useMemo(() => {
    let result = [...records];

    // 搜索：按名称模糊匹配
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(r => r.app_name.toLowerCase().includes(q));
    }

    // 类型筛选
    if (filterType !== 'all') {
      result = result.filter(r => (r.record_type || 'App') === filterType);
    }

    // 排序
    result.sort((a, b) => {
      switch (sortBy) {
        case 'date_asc': return a.migrated_at - b.migrated_at;
        case 'size_desc': return b.size - a.size;
        case 'size_asc': return a.size - b.size;
        case 'date_desc':
        default: return b.migrated_at - a.migrated_at;
      }
    });

    return result;
  }, [records, searchQuery, filterType, sortBy]);

  // 分页
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const pageRecords = filteredRecords.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // 搜索/筛选变化时回到第一页
  useEffect(() => { setCurrentPage(1); }, [searchQuery, filterType]);

  return (
    <div className="h-full overflow-hidden flex flex-col px-5 py-4">
      <div className="h-full max-w-6xl mx-auto flex flex-col w-full gap-4">
        {/* 顶部：统计 + 刷新 */}
        <header className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            {records.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--bg-card)] text-[12px] shadow-[0_1px_0_rgba(15,23,42,0.05)] dark:shadow-[0_1px_0_rgba(0,0,0,0.32)]">
                  <History className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                  <span className="font-semibold text-[var(--text-primary)]">{records.length}</span>
                  <span className="text-[var(--text-muted)]">项记录</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--bg-card)] text-[12px] shadow-[0_1px_0_rgba(15,23,42,0.05)] dark:shadow-[0_1px_0_rgba(0,0,0,0.32)]">
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

        {/* 搜索/筛选/排序栏 */}
        {records.length > 0 && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索名称..."
                  className="w-full h-8 pl-8 pr-3 text-[12px] rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)] transition-colors"
                />
              </div>
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value as 'all' | 'App' | 'LargeFolder')}
                className="h-8 px-2.5 text-[12px] rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none cursor-pointer"
              >
                <option value="all">全部类型</option>
                <option value="App">应用</option>
                <option value="LargeFolder">文件夹</option>
              </select>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="h-8 px-2.5 text-[12px] rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none cursor-pointer"
              >
                <option value="date_desc">最新优先</option>
                <option value="date_asc">最早优先</option>
                <option value="size_desc">体积最大</option>
                <option value="size_asc">体积最小</option>
              </select>
            </div>
            {filteredRecords.length !== records.length && (
              <span className="text-[11px] text-[var(--text-tertiary)] flex-shrink-0">
                显示 {filteredRecords.length}/{records.length}
              </span>
            )}
          </div>
        )}

        {/* 内容区 */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
            <span className="text-[13px]">加载中...</span>
          </div>
        ) : records.length === 0 ? (
          <EmptyState />
        ) : pageRecords.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
            <Search className="w-5 h-5 text-[var(--text-muted)] mb-2" />
            <p className="text-[13px] text-[var(--text-secondary)]">无匹配记录</p>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-1">尝试调整搜索或筛选条件</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-1">
            <div className="space-y-2 py-1">
              {pageRecords.map((record) => (
                <HistoryRow
                  key={record.id}
                  record={record}
                  onRestore={handleRestore}
                  isRestoring={restoringId === record.id}
                  linkStatus={linkStatuses[record.id] || 'unknown'}
                />
              ))}
            </div>
            {/* 分页控件 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-3">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="h-7 px-2.5 text-[11px] rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-colors"
                >
                  上一页
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p)}
                    className="h-7 w-7 text-[11px] rounded border transition-colors"
                    style={{
                      background: p === currentPage ? 'var(--color-primary)' : 'transparent',
                      borderColor: p === currentPage ? 'var(--color-primary)' : 'var(--border-color)',
                      color: p === currentPage ? 'white' : 'var(--text-secondary)',
                    }}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="h-7 px-2.5 text-[11px] rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-colors"
                >
                  下一页
                </button>
              </div>
            )}
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
