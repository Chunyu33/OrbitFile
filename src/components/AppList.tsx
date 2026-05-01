// 应用列表组件 — 桌面工具风格
// 表格化行布局，紧凑信息密度，弱化操作按钮视觉

import { Package, Search, Link2, Check, ArrowRightLeft, FolderOpen } from 'lucide-react';
import { InstalledApp } from '../types';
import { useState, useMemo, useDeferredValue } from 'react';
import FilterSelect from './FilterSelect';

type MigrationFilter = 'all' | 'migrated' | 'not_migrated';
type DriveFilter = 'all' | 'c' | 'other';

function extractDriveLetters(apps: InstalledApp[]): string[] {
  const drives = new Set<string>();
  for (const app of apps) {
    const match = app.install_location.match(/^([A-Za-z]):/i);
    if (match) drives.add(match[1].toUpperCase());
  }
  return Array.from(drives).sort();
}

interface AppListProps {
  apps: InstalledApp[];
  loading: boolean;
  onMigrate: (app: InstalledApp) => void;
  onRestore: (app: InstalledApp) => void;
  onUninstall: (app: InstalledApp) => void;
  onOpenFolder?: (app: InstalledApp) => void;
  uninstallingKey?: string | null;
  restoringKey?: string | null;
  migratedPaths?: string[];
  selectedKeys?: Set<string>;
  onToggleSelect?: (app: InstalledApp) => void;
  onSelectAll?: () => void;
  onBatchMigrate?: () => void;
  batchMigrating?: boolean;
  batchProgress?: { current: number; total: number };
}

function formatSize(kb: number): string {
  if (kb === 0) return '—'; // em dash
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
}

function AppIcon({ app }: { app: InstalledApp }) {
  if (app.icon_base64) {
    return (
      <div
        className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 overflow-hidden"
        style={{ background: 'var(--color-gray-100)' }}
      >
        <img
          src={app.icon_base64}
          alt=""
          className="w-5 h-5 object-contain"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </div>
    );
  }
  const initial = app.display_name.charAt(0).toUpperCase();
  const hue = (app.display_name.charCodeAt(0) * 37) % 360;
  return (
    <div
      className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 text-[11px] font-semibold text-white"
      style={{ background: `hsl(${hue}, 55%, 55%)` }}
    >
      {initial}
    </div>
  );
}

function AppRow({
  app, onMigrate, onRestore, onUninstall, onOpenFolder,
  isUninstalling, isMigrated, isRestoring,
  isSelected, onToggleSelect, showCheckbox,
}: {
  app: InstalledApp;
  onMigrate: (app: InstalledApp) => void;
  onRestore: (app: InstalledApp) => void;
  onUninstall: (app: InstalledApp) => void;
  onOpenFolder: (app: InstalledApp) => void;
  isUninstalling: boolean;
  isMigrated: boolean;
  isRestoring: boolean;
  isSelected?: boolean;
  onToggleSelect?: (app: InstalledApp) => void;
  showCheckbox?: boolean;
}) {
  const rowStyle: React.CSSProperties = {
    height: 'var(--row-height)' as unknown as string,
    padding: '0 8px',
    background: isSelected ? 'var(--bg-row-selected)' : 'transparent',
    borderBottom: '1px solid var(--border-color)',
  } as React.CSSProperties;

  return (
    <div
      className="flex items-center gap-3 transition-colors relative"
      style={rowStyle}
      onMouseEnter={(e) => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-row-hover)';
      }}
      onMouseLeave={(e) => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {/* checkbox */}
      {showCheckbox && !isMigrated && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(app); }}
          className={`flex-shrink-0 w-4 h-4 rounded-sm border flex items-center justify-center ${
            isSelected
              ? ''
              : 'border-[var(--border-color-strong)] opacity-60 hover:opacity-100'
          }`}
          style={isSelected ? {
            background: 'var(--color-primary)',
            borderColor: 'var(--color-primary)',
          } : undefined}
        >
          {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </button>
      )}
      {showCheckbox && isMigrated && <div className="flex-shrink-0 w-4 h-4" />}

      {/* left bar for migrated */}
      {isMigrated && (
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5"
          style={{ background: 'var(--color-primary)' }}
        />
      )}

      {/* icon */}
      <AppIcon app={app} />

      {/* name + path */}
      <div className="flex-1 min-w-0 flex items-center gap-4">
        <div className="flex items-center gap-2 min-w-0" style={{ maxWidth: '280px' }}>
          <span
            className="text-[13px] font-medium truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {app.display_name}
          </span>
          {isMigrated && (
            <span className="badge badge-success flex-shrink-0">
              <Link2 className="w-2.5 h-2.5" />
              已迁移
            </span>
          )}
        </div>
        <span
          className="text-[11px] truncate flex-1 min-w-0 hidden sm:block"
          style={{ color: 'var(--text-tertiary)' }}
          title={app.install_location}
        >
          {app.install_location}
        </span>
      </div>

      {/* size */}
      <span
        className="text-[11px] tabular-nums flex-shrink-0 w-16 text-right"
        style={{ color: 'var(--text-secondary)' }}
      >
        {formatSize(app.estimated_size)}
      </span>

      {/* actions */}
      <div className="flex items-center gap-1 flex-shrink-0" style={{ width: '130px', justifyContent: 'flex-end' }}>
        <button
          onClick={() => onOpenFolder(app)}
          className="btn btn-ghost btn-icon"
          title="打开目录"
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>

        {isMigrated ? (
          <button
            onClick={() => onRestore(app)}
            disabled={isRestoring}
            className="btn btn-sm h-6 text-[11px]"
          >
            {isRestoring ? '还原中...' : '还原'}
          </button>
        ) : (
          <button
            onClick={() => onMigrate(app)}
            className="btn btn-primary btn-sm h-6 text-[11px]"
          >
            迁移
          </button>
        )}

        <button
          onClick={() => onUninstall(app)}
          disabled={isUninstalling}
          className="btn btn-link btn-link-danger h-6 text-[11px]"
        >
          {isUninstalling ? '卸载中...' : '卸载'}
        </button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const rowStyle: React.CSSProperties = {
    height: 'var(--row-height)' as unknown as string,
    padding: '0 8px',
    borderBottom: '1px solid var(--border-color)',
  } as React.CSSProperties;

  return (
    <div className="flex flex-col">
      {items.map((i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse" style={rowStyle}>
          <div className="w-4 h-4 rounded-sm" style={{ background: 'var(--bg-row-hover)' }} />
          <div className="w-7 h-7 rounded" style={{ background: 'var(--bg-row-hover)' }} />
          <div className="flex-1 min-w-0">
            <div className="h-3 rounded w-32" style={{ background: 'var(--bg-row-hover)' }} />
          </div>
          <div className="w-16 h-3 rounded" style={{ background: 'var(--bg-row-hover)' }} />
          <div className="flex gap-1" style={{ width: '130px', justifyContent: 'flex-end' }}>
            <div className="w-7 h-7 rounded" style={{ background: 'var(--bg-row-hover)' }} />
            <div className="w-12 h-7 rounded" style={{ background: 'var(--bg-row-hover)' }} />
            <div className="w-10 h-7 rounded" style={{ background: 'var(--bg-row-hover)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AppList({
  apps, loading, onMigrate, onRestore, onUninstall, onOpenFolder,
  uninstallingKey = null, restoringKey = null, migratedPaths = [],
  selectedKeys, onToggleSelect, onSelectAll, onBatchMigrate,
  batchMigrating = false, batchProgress,
}: AppListProps) {
  const defaultOpenFolder = async (app: InstalledApp) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_folder', { path: app.install_location });
    } catch (error) {
      console.error('Failed to open folder:', error);
    }
  };
  const handleOpenFolder = onOpenFolder ?? defaultOpenFolder;
  const [inputQuery, setInputQuery] = useState('');
  const [migrationFilter, setMigrationFilter] = useState<MigrationFilter>('all');
  const [driveFilter, setDriveFilter] = useState<DriveFilter>('all');
  const deferredSearchQuery = useDeferredValue(inputQuery);
  const migratedPathSet = useMemo(
    () => new Set(migratedPaths.map((path) => path.toLowerCase())),
    [migratedPaths],
  );

  const isAppMigrated = (app: InstalledApp): boolean =>
    migratedPathSet.has(app.install_location.toLowerCase());

  const availableDrives = useMemo(() => extractDriveLetters(apps), [apps]);
  const otherDrives = useMemo(() => availableDrives.filter(d => d !== 'C'), [availableDrives]);

  const filteredApps = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    return apps.filter(app => {
      if (q && !app.display_name.toLowerCase().includes(q) && !app.install_location.toLowerCase().includes(q)) {
        return false;
      }
      if (migrationFilter !== 'all') {
        const migrated = migratedPathSet.has(app.install_location.toLowerCase());
        if (migrationFilter === 'migrated' && !migrated) return false;
        if (migrationFilter === 'not_migrated' && migrated) return false;
      }
      if (driveFilter !== 'all') {
        const dl = app.install_location.charAt(0).toUpperCase();
        if (driveFilter === 'c' && dl !== 'C') return false;
        if (driveFilter === 'other' && dl === 'C') return false;
      }
      return true;
    });
  }, [apps, deferredSearchQuery, migrationFilter, driveFilter, migratedPathSet]);

  const migrationOptions: { value: MigrationFilter; label: string }[] = [
    { value: 'all', label: '全部状态' },
    { value: 'migrated', label: '已迁移' },
    { value: 'not_migrated', label: '未迁移' },
  ];

  const selectableCount = useMemo(
    () => filteredApps.filter(a => !isAppMigrated(a)).length,
    [filteredApps, migratedPathSet],
  );

  const driveOptions: { value: DriveFilter; label: string }[] = [
    { value: 'all', label: '全部盘' },
    { value: 'c', label: 'C 盘' },
    { value: 'other', label: `其他盘${otherDrives.length > 0 ? ` (${otherDrives.join('/')})` : ''}` },
  ];

  if (loading) {
    const loadingHint = '正在扫描应用...';
    return (
      <div className="h-full flex flex-col">
        <div
          className="flex items-center gap-2 mb-2 text-[12px]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <div className="w-3.5 h-3.5 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          {loadingHint}
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (apps.length === 0) {
    const emptyMsg = '未找到可迁移的应用';
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Package className="w-6 h-6 mb-2" style={{ color: 'var(--text-tertiary)' }} />
        <p
          className="text-[13px] font-medium"
          style={{ color: 'var(--text-secondary)' }}
        >
          {emptyMsg}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-shrink-0 mb-1" style={{ padding: '2px 8px' }}>
        <div className="relative flex-1 max-w-xs">
          <Search
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
            style={{ color: 'var(--text-tertiary)' }}
          />
          <input
            type="text"
            placeholder="搜索应用..."
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            className="w-full h-8 pl-7 pr-2 text-[12px] rounded border outline-none transition-colors"
            style={{
              background: 'var(--bg-input)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-primary)',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          />
        </div>
        <FilterSelect
          value={migrationFilter}
          onChange={setMigrationFilter}
          options={migrationOptions}
          className="w-[120px]"
        />
        <FilterSelect
          value={driveFilter}
          onChange={setDriveFilter}
          options={driveOptions}
          className="w-[120px]"
        />
        <span
          className="text-[11px] flex-shrink-0 ml-1"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {filteredApps.length} 个
        </span>

        {onToggleSelect && onSelectAll && onBatchMigrate && (
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={onSelectAll} className="text-[11px] btn-link">
              {selectableCount > 0 && selectedKeys && selectedKeys.size === selectableCount
                ? '取消全选'
                : '全选未迁移'}
            </button>
            <button
              onClick={onBatchMigrate}
              disabled={batchMigrating || !selectedKeys || selectedKeys.size === 0}
              className="btn btn-primary h-7 text-[11px]"
              style={{
                visibility: selectedKeys && selectedKeys.size > 0 ? 'visible' : 'hidden',
              }}
            >
              <ArrowRightLeft className="w-3 h-3" />
              {batchMigrating && batchProgress
                ? `迁移中 ${batchProgress.current}/${batchProgress.total}`
                : `批量迁移 (${selectedKeys?.size ?? 0})`}
            </button>
          </div>
        )}
      </div>

      {/* column header */}
      <div
        className="flex items-center gap-3 flex-shrink-0 text-[10px] uppercase tracking-wider"
        style={{
          padding: '0 8px',
          height: '24px',
          color: 'var(--text-tertiary)',
          borderBottom: '1px solid var(--border-color-strong)',
        }}
      >
        <div className="flex-shrink-0 w-4" />
        <div className="flex-shrink-0 w-7" />
        <span className="flex-1 min-w-0">名称</span>
        <span className="flex-shrink-0 w-16 text-right">大小</span>
        <span className="flex-shrink-0" style={{ width: '130px', textAlign: 'right' }}>操作</span>
      </div>

      {/* list body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filteredApps.length > 0 ? (
          <div className="flex flex-col">
            {filteredApps.map((app) => {
              const key = app.registry_path || app.install_location;
              return (
                <AppRow
                  key={key}
                  app={app}
                  onMigrate={onMigrate}
                  onRestore={onRestore}
                  onUninstall={onUninstall}
                  onOpenFolder={handleOpenFolder}
                  isUninstalling={uninstallingKey === `${app.display_name}|${app.registry_path}`}
                  isRestoring={restoringKey === `${app.display_name}|${app.registry_path}`}
                  isMigrated={isAppMigrated(app)}
                  isSelected={selectedKeys?.has(key)}
                  onToggleSelect={onToggleSelect}
                  showCheckbox={!!onToggleSelect}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="w-5 h-5 mb-2" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>未找到匹配的应用</p>
          </div>
        )}
      </div>
    </div>
  );
}
