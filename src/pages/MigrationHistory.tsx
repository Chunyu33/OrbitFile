// 迁移历史页面 — 桌面工具风格
// 表格化行布局，紧凑信息密度

import { useEffect, useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  History, RotateCcw, RefreshCw, Loader2,
  FolderArchive, AppWindow, ArrowRight, CheckCircle2, AlertTriangle,
  Search, ChevronDown, ChevronUp,
} from 'lucide-react';
import { MigrationRecord, MigrationResult } from '../types';
import Toast, { useToast } from '../components/Toast';
import FilterSelect from '../components/FilterSelect';

type LinkStatus = 'checking' | 'healthy' | 'broken' | 'unknown';

function formatSize(bytes: number): string {
  if (bytes === 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function shortenPath(path: string): string {
  if (path.length <= 36) return path;
  const parts = path.split('\\');
  if (parts.length <= 2) return path;
  return `${parts[0]}\\...\\${parts.slice(-2).join('\\')}`;
}

// health cache
const HEALTH_CACHE_KEY = 'orbitfile_health_cache';
const HEALTH_CACHE_TTL = 5 * 60 * 1000;

interface CachedHealth { status: LinkStatus; timestamp: number; }

function loadHealthCache(): Record<string, CachedHealth> {
  try { const raw = localStorage.getItem(HEALTH_CACHE_KEY); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
function saveHealthCache(cache: Record<string, CachedHealth>) {
  try { localStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify(cache)); } catch { /* quota */ }
}
function getCachedStatus(id: string): LinkStatus | null {
  const entry = loadHealthCache()[id];
  return entry && Date.now() - entry.timestamp < HEALTH_CACHE_TTL ? entry.status : null;
}
function setCachedStatus(id: string, status: LinkStatus) {
  const cache = loadHealthCache();
  cache[id] = { status, timestamp: Date.now() };
  saveHealthCache(cache);
}

function HistoryRow({
  record, onRestore, isRestoring, linkStatus,
}: {
  record: MigrationRecord;
  onRestore: (id: string, recordType: string) => void;
  isRestoring: boolean;
  linkStatus: LinkStatus;
}) {
  const isLargeFolder = record.record_type === 'LargeFolder';
  const [expanded, setExpanded] = useState(false);

  const rowStyle: React.CSSProperties = {
    borderBottom: '1px solid var(--border-color)',
    background: linkStatus === 'broken' ? 'var(--color-danger-light)' : 'transparent',
  } as React.CSSProperties;

  return (
    <div style={rowStyle}>
      <div
        className="flex items-center gap-3 cursor-pointer"
        style={{ height: 'var(--row-height)', padding: '0 8px' }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={(e) => {
          if (linkStatus !== 'broken') (e.currentTarget as HTMLElement).style.background = 'var(--bg-row-hover)';
        }}
        onMouseLeave={(e) => {
          if (linkStatus !== 'broken') (e.currentTarget as HTMLElement).style.background = 'var(--rowStyle-background, transparent)';
        }}
      >
        {/* icon */}
        <div
          className="w-7 h-7 rounded flex-shrink-0 flex items-center justify-center"
          style={{ color: isLargeFolder ? 'var(--color-warning)' : 'var(--color-primary)' }}
        >
          {isLargeFolder ? <FolderArchive className="w-4 h-4" /> : <AppWindow className="w-4 h-4" />}
        </div>

        {/* name + type + date */}
        <div className="flex-shrink-0" style={{ width: '180px' }}>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)', maxWidth: '120px' }} title={record.app_name}>
              {record.app_name}
            </span>
            <span className={`badge flex-shrink-0 ${isLargeFolder ? 'text-[var(--color-warning)]' : ''}`}
              style={isLargeFolder ? { background: 'var(--color-warning-light)', color: 'var(--color-warning)' } : undefined}>
              {isLargeFolder ? '文件夹' : '应用'}
            </span>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{formatDate(record.migrated_at)}</p>
        </div>

        {/* path */}
        <div className="flex-1 min-w-0 flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          <span className="truncate" style={{ maxWidth: '40%' }} title={record.original_path}>{shortenPath(record.original_path)}</span>
          <ArrowRight className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />
          <span className="truncate" style={{ maxWidth: '40%', color: 'var(--color-success)' }} title={record.target_path}>{shortenPath(record.target_path)}</span>
        </div>

        {/* status */}
        <div className="flex-shrink-0 w-5 flex justify-center" title={linkStatus === 'healthy' ? '正常' : linkStatus === 'broken' ? '损坏' : ''}>
          {linkStatus === 'checking' && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--text-tertiary)' }} />}
          {linkStatus === 'healthy' && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />}
          {linkStatus === 'broken' && <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-danger)' }} />}
        </div>

        {/* size */}
        <span className="text-[11px] tabular-nums flex-shrink-0 w-16 text-right" style={{ color: 'var(--text-secondary)' }}>
          {formatSize(record.size)}
        </span>

        {/* restore */}
        <button
          onClick={e => { e.stopPropagation(); onRestore(record.id, record.record_type || 'App'); }}
          disabled={isRestoring}
          className="btn btn-sm h-6 text-[11px] flex-shrink-0"
          title="恢复"
        >
          {isRestoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          恢复
        </button>

        {/* expand toggle */}
        <div className="flex-shrink-0 w-4">
          {expanded
            ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
            : <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
          }
        </div>
      </div>

      {/* expand detail panel */}
      {expanded && (
        <div
          className="px-5 py-3 grid grid-cols-2 gap-x-8 gap-y-2 text-[11px]"
          style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-row-hover)' }}
          onClick={e => e.stopPropagation()}
        >
          <div>
            <span style={{ color: 'var(--text-tertiary)' }}>原始路径</span>
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
            <p className="break-all text-[10px]" style={{ color: 'var(--text-primary)' }}>{record.id}</p>
          </div>
          <div>
            <span style={{ color: 'var(--text-tertiary)' }}>链接状态</span>
            <p style={{
              color: linkStatus === 'healthy' ? 'var(--color-success)'
                : linkStatus === 'broken' ? 'var(--color-danger)' : 'var(--text-secondary)'
            }}>
              {linkStatus === 'healthy' ? '正常' : linkStatus === 'broken' ? '损坏' : linkStatus === 'checking' ? '检查中' : '未知'}
            </p>
          </div>
          <div>
            <span style={{ color: 'var(--text-tertiary)' }}>大小</span>
            <p style={{ color: 'var(--text-primary)' }}>{formatSize(record.size)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MigrationHistory() {
  const [records, setRecords] = useState<MigrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [linkStatuses, setLinkStatuses] = useState<Record<string, LinkStatus>>({});
  const { toast, showToast, hideToast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'App' | 'LargeFolder'>('all');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'size_desc' | 'size_asc'>('date_desc');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  async function loadHistory() {
    try {
      setLoading(true);
      const history = await invoke<MigrationRecord[]>('get_migration_history');
      setRecords(history);

      const initialStatuses: Record<string, LinkStatus> = {};
      const needCheck: MigrationRecord[] = [];
      for (const r of history) {
        const cached = getCachedStatus(r.id);
        if (cached && cached !== 'checking') { initialStatuses[r.id] = cached; }
        else { initialStatuses[r.id] = 'checking'; needCheck.push(r); }
      }
      setLinkStatuses(initialStatuses);

      // concurrent check (max 5)
      async function runWithConcurrency(
        items: MigrationRecord[], limit: number, worker: (r: MigrationRecord) => Promise<void>,
      ) {
        const queue = [...items];
        const active: Promise<void>[] = [];
        async function next() {
          while (queue.length > 0) {
            const item = queue.shift()!;
            const p = worker(item);
            active.push(p);
            p.finally(() => { active.splice(active.indexOf(p), 1); });
            if (active.length >= limit) await Promise.race(active);
          }
          await Promise.all(active);
        }
        await next();
      }

      runWithConcurrency(needCheck, 5, async (record) => {
        try {
          const result = await invoke<{ healthy: boolean; target_exists: boolean }>('check_link_status', { recordId: record.id });
          const status: LinkStatus = result.healthy ? 'healthy' : 'broken';
          setCachedStatus(record.id, status);
          setLinkStatuses(prev => ({ ...prev, [record.id]: status }));
        } catch {
          setLinkStatuses(prev => ({ ...prev, [record.id]: 'unknown' }));
        }
      });
    } catch (error) {
      console.error('Failed to load history:', error);
      showToast('加载历史记录失败', 'error');
    } finally { setLoading(false); }
  }

  async function handleRestore(historyId: string, recordType: string) {
    try {
      setRestoringId(historyId);
      const record = records.find(r => r.id === historyId);
      let result: MigrationResult;

      if (recordType === 'LargeFolder' && record) {
        result = await invoke<MigrationResult>('restore_large_folder', { junctionPath: record.original_path });
      } else {
        result = await invoke<MigrationResult>('restore_app', { historyId });
      }

      if (result.success) {
        showToast('已成功恢复', 'success');
        await loadHistory();
      } else {
        showToast(result.message, 'error');
      }
    } catch (error) {
      showToast(`恢复失败: ${error}`, 'error');
    } finally { setRestoringId(null); }
  }

  useEffect(() => { loadHistory(); }, []);

  const totalSize = records.reduce((sum, r) => sum + r.size, 0);
  const brokenCount = Object.values(linkStatuses).filter(s => s === 'broken').length;

  const filteredRecords = useMemo(() => {
    let result = [...records];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(r => r.app_name.toLowerCase().includes(q));
    }
    if (filterType !== 'all') {
      result = result.filter(r => (r.record_type || 'App') === filterType);
    }
    result.sort((a, b) => {
      switch (sortBy) {
        case 'date_asc': return a.migrated_at - b.migrated_at;
        case 'size_desc': return b.size - a.size;
        case 'size_asc': return a.size - b.size;
        default: return b.migrated_at - a.migrated_at;
      }
    });
    return result;
  }, [records, searchQuery, filterType, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const pageRecords = filteredRecords.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, filterType]);

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ padding: '12px 16px' }}>
      <div className="h-full flex flex-col w-full gap-3">
        {/* header */}
        <div className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4 text-[12px]">
            {records.length > 0 && (
              <>
                <span style={{ color: 'var(--text-secondary)' }}>
                  <History className="w-3.5 h-3.5 inline mr-1" style={{ color: 'var(--text-primary)' }} />
                  <strong style={{ color: 'var(--text-primary)' }}>{records.length}</strong> 项记录
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  已释放 <strong style={{ color: 'var(--color-success)' }}>{formatSize(totalSize)}</strong>
                </span>
                {brokenCount > 0 && (
                  <span style={{ color: 'var(--color-danger)' }}>
                    <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                    <strong>{brokenCount}</strong> 个异常
                  </span>
                )}
              </>
            )}
          </div>
          <button onClick={loadHistory} disabled={loading} className="btn h-7 text-[12px]">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* search / filter / sort */}
        {records.length > 0 && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
              <input
                type="text" placeholder="搜索名称..." value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full h-8 pl-7 pr-2 text-[12px] rounded border outline-none transition-colors"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
              />
            </div>
            <FilterSelect value={filterType} onChange={setFilterType}
              options={[
                { value: 'all' as const, label: '全部类型' },
                { value: 'App' as const, label: '应用' },
                { value: 'LargeFolder' as const, label: '文件夹' },
              ]}
              className="w-[110px]" />
            <FilterSelect value={sortBy} onChange={setSortBy}
              options={[
                { value: 'date_desc' as const, label: '最新优先' },
                { value: 'date_asc' as const, label: '最早优先' },
                { value: 'size_desc' as const, label: '体积最大' },
                { value: 'size_asc' as const, label: '体积最小' },
              ]}
              className="w-[110px]" />
            {filteredRecords.length !== records.length && (
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                显示 {filteredRecords.length}/{records.length}
              </span>
            )}
          </div>
        )}

        {/* body */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-primary)' }} />
          </div>
        ) : records.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <History className="w-6 h-6 mb-2" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>暂无迁移记录</p>
          </div>
        ) : pageRecords.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <Search className="w-5 h-5 mb-2" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>无匹配记录</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* column header */}
            <div className="flex items-center gap-3 flex-shrink-0 text-[10px] uppercase tracking-wider"
              style={{ padding: '0 8px', height: '24px', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-color-strong)' }}>
              <div className="flex-shrink-0 w-7" />
              <span className="flex-shrink-0" style={{ width: '180px' }}>名称</span>
              <span className="flex-1 min-w-0">路径</span>
              <div className="flex-shrink-0 w-5" />
              <span className="flex-shrink-0 w-16 text-right">大小</span>
              <span className="flex-shrink-0" style={{ width: '84px' }} />
            </div>

            {pageRecords.map(record => (
              <HistoryRow key={record.id} record={record}
                onRestore={handleRestore}
                isRestoring={restoringId === record.id}
                linkStatus={linkStatuses[record.id] || 'unknown'} />
            ))}

            {/* pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1.5 py-3">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                  className="btn h-6 text-[11px] px-2">上一页</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setCurrentPage(p)}
                    className="h-6 min-w-[24px] text-[11px] rounded border transition-colors"
                    style={{
                      background: p === currentPage ? 'var(--color-primary)' : 'transparent',
                      borderColor: p === currentPage ? 'var(--color-primary)' : 'var(--border-color)',
                      color: p === currentPage ? 'var(--text-inverse)' : 'var(--text-secondary)',
                    }}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                  className="btn h-6 text-[11px] px-2">下一页</button>
              </div>
            )}
          </div>
        )}
      </div>
      <Toast message={toast.message} type={toast.type} visible={toast.visible} onClose={hideToast} />
    </div>
  );
}
