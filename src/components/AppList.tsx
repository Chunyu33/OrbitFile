// 应用列表组件

import { Package, Search, FolderOpen, Link2 } from 'lucide-react';

import { InstalledApp } from '../types';
import { useState, useMemo } from 'react';
import FilterSelect from './FilterSelect';

// 迁移状态筛选选项
type MigrationFilter = 'all' | 'migrated' | 'not_migrated';
// 盘符筛选选项
type DriveFilter = 'all' | 'c' | 'other';

// 从应用列表中提取所有盘符（高性能：仅遍历已加载的 apps，不调用系统 API）
function extractDriveLetters(apps: InstalledApp[]): string[] {
  const drives = new Set<string>();
  for (const app of apps) {
    const match = app.install_location.match(/^([A-Za-z]):/i);
    if (match) {
      drives.add(match[1].toUpperCase());
    }
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
  migratedPaths?: string[];
}

// 格式化文件大小
function formatSize(kb: number): string {
  if (kb === 0) return '未知';
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
}

// 根据应用名生成头像颜色
function getAvatarColor(name: string, isMigrated: boolean): string {
  if (isMigrated) return 'var(--color-success)';
  const colors = ['#2563EB', '#7C3AED', '#DC2626', '#0891B2', '#6B7280', '#059669'];
  return colors[name.charCodeAt(0) % colors.length];
}


// 应用图标组件 - 显示真实图标或首字母回退
function AppIcon({ app, isMigrated }: { app: InstalledApp; isMigrated: boolean }) {
  const initial = app.display_name.charAt(0).toUpperCase();
  const bgColor = getAvatarColor(app.display_name, isMigrated);
  
  // 如果有 Base64 图标数据，显示真实图标
  if (app.icon_base64) {
    return (
      <div 
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
        style={{ backgroundColor: 'var(--color-gray-100)' }}
      >
        <img 
          src={app.icon_base64} 
          alt={app.display_name}
          className="w-8 h-8 object-contain"
          onError={(e) => {
            // 图标加载失败时隐藏图片，显示首字母
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    );
  }
  
  // 回退到首字母图标
  return (
    <div 
      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
      style={{ backgroundColor: bgColor }}
    >
      <span style={{ color: 'white', fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--font-size-sm)' }}>
        {initial}
      </span>
    </div>
  );
}

// 应用行组件
function AppRow({ 
  app, 
  onMigrate, 
  onRestore,
  onUninstall,
  onOpenFolder,
  isUninstalling,
  isMigrated,
}: { 
  app: InstalledApp; 
  onMigrate: (app: InstalledApp) => void;
  onRestore: (app: InstalledApp) => void;
  onUninstall: (app: InstalledApp) => void;
  onOpenFolder: (app: InstalledApp) => void;
  isUninstalling: boolean;
  isMigrated: boolean;
}) {
  return (
    <div className="group relative rounded-xl bg-[var(--bg-card)] px-4 py-3 shadow-[0_1px_0_rgba(15,23,42,0.04),0_6px_18px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(15,23,42,0.1)] dark:shadow-[0_1px_0_rgba(0,0,0,0.28),0_8px_22px_rgba(0,0,0,0.28)] dark:hover:shadow-[0_12px_28px_rgba(0,0,0,0.36)]">
      <div className="flex items-center gap-3">
        {/* 迁移状态左边框 */}
        {isMigrated && (
          <span className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-[var(--color-primary)]" />
        )}

        {/* 应用图标 */}
        <div className="rounded-xl p-0.5 bg-[var(--bg-hover)]/40">
          <AppIcon app={app} isMigrated={isMigrated} />
        </div>

        {/* 应用信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
              {app.display_name}
            </span>
            {isMigrated && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full"
                style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                <Link2 className="w-2.5 h-2.5" />
                已迁移
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)] truncate mt-0.5">
            {app.install_location}
          </p>
        </div>

        {/* 大小 */}
        <div className="flex-shrink-0">
          <div className="px-2.5 h-7 rounded-full bg-[var(--bg-hover)]/75 inline-flex items-center">
            <span className="text-[11px] font-semibold text-[var(--text-secondary)] tabular-nums">
              {formatSize(app.estimated_size)}
            </span>
          </div>
        </div>

        {/* 操作区 */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => onOpenFolder(app)}
            className="h-8 w-8 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors inline-flex items-center justify-center"
            title="打开目录"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>

          {isMigrated ? (
            <button
              onClick={() => onRestore(app)}
              className="h-8 min-w-[68px] px-3 text-[12px] font-medium rounded-md bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--color-primary)] transition-colors"
            >
              还原
            </button>
          ) : (
            <button
              onClick={() => onMigrate(app)}
              className="h-8 min-w-[68px] px-3 text-[12px] font-semibold rounded-md text-white transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-primary)' }}
            >
              迁移
            </button>
          )}

          <button
            onClick={() => onUninstall(app)}
            disabled={isUninstalling}
            className="h-8 px-3 rounded-md text-[12px] font-medium text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
          >
            {isUninstalling ? '卸载中...' : '强力卸载'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 加载骨架屏
function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse">
          <div className="w-10 h-10 rounded-xl bg-[var(--bg-hover)]" />
          <div className="flex-1 min-w-0">
            <div className="h-3.5 rounded w-40 mb-1.5 bg-[var(--bg-hover)]" />
            <div className="h-3 rounded w-56 bg-[var(--bg-hover)]" />
          </div>
          <div className="w-20 h-8 rounded-md bg-[var(--bg-hover)]" />
        </div>
      ))}
    </div>
  );
}

export default function AppList({ apps, loading, onMigrate, onRestore, onUninstall, onOpenFolder, uninstallingKey = null, migratedPaths = [] }: AppListProps) {
  // 默认的打开目录实现（无外部回调时）
  const defaultOpenFolder = async (app: InstalledApp) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_folder', { path: app.install_location });
    } catch (error) {
      console.error('打开文件夹失败:', error);
    }
  };
  const handleOpenFolder = onOpenFolder ?? defaultOpenFolder;
  const [searchQuery, setSearchQuery] = useState('');
  const [migrationFilter, setMigrationFilter] = useState<MigrationFilter>('all');
  const [driveFilter, setDriveFilter] = useState<DriveFilter>('all');

  // 检查应用是否已迁移
  const isAppMigrated = (app: InstalledApp): boolean => {
    return migratedPaths.some(path => 
      path.toLowerCase() === app.install_location.toLowerCase()
    );
  };

  // 提取所有盘符（用于显示“其他盘”的具体列表）
  const availableDrives = useMemo(() => extractDriveLetters(apps), [apps]);
  const otherDrives = useMemo(() => availableDrives.filter(d => d !== 'C'), [availableDrives]);

  const filteredApps = useMemo(() => {
    return apps.filter(app => {
      // 搜索关键词过滤
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        if (!app.display_name.toLowerCase().includes(query) &&
            !app.install_location.toLowerCase().includes(query)) {
          return false;
        }
      }
      // 迁移状态过滤
      if (migrationFilter !== 'all') {
        const migrated = isAppMigrated(app);
        if (migrationFilter === 'migrated' && !migrated) return false;
        if (migrationFilter === 'not_migrated' && migrated) return false;
      }
      // 盘符过滤
      if (driveFilter !== 'all') {
        const driveLetter = app.install_location.charAt(0).toUpperCase();
        if (driveFilter === 'c' && driveLetter !== 'C') return false;
        if (driveFilter === 'other' && driveLetter === 'C') return false;
      }
      return true;
    });
  }, [apps, searchQuery, migrationFilter, driveFilter, migratedPaths]);

  const migrationOptions: { value: MigrationFilter; label: string }[] = [
    { value: 'all', label: '全部状态' },
    { value: 'migrated', label: '已迁移' },
    { value: 'not_migrated', label: '未迁移' },
  ];

  const driveOptions: { value: DriveFilter; label: string }[] = [
    { value: 'all', label: '全部盘' },
    { value: 'c', label: 'C 盘' },
    { value: 'other', label: `其他盘${otherDrives.length > 0 ? ` (${otherDrives.join('/')})` : ''}` },
  ];

  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 mb-3 text-[13px] text-[var(--text-tertiary)]">
          <div className="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          <span>正在扫描应用...</span>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-xl bg-[var(--bg-hover)] flex items-center justify-center mb-3">
          <Package className="w-5 h-5 text-[var(--text-muted)]" />
        </div>
        <p className="text-[14px] font-medium text-[var(--text-primary)] mb-1">未找到可迁移的应用</p>
        <p className="text-[12px] text-[var(--text-tertiary)]">请确保 C 盘有已安装的应用程序</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 搜索栏与筛选器 - 紧凑设计 */}
      <div className="flex items-center gap-2 mb-4 p-2 rounded-xl bg-[var(--bg-card)]/80 backdrop-blur-sm shadow-[0_6px_16px_rgba(15,23,42,0.05)] dark:shadow-[0_8px_22px_rgba(0,0,0,0.25)]">
        {/* 搜索框 */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="搜索应用..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-[13px] rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--color-primary)] transition-colors"
          />
        </div>

        {/* 迁移状态筛选 */}
        <FilterSelect
          value={migrationFilter}
          onChange={setMigrationFilter}
          options={migrationOptions}
        />

        {/* 盘符筛选 */}
        <FilterSelect
          value={driveFilter}
          onChange={setDriveFilter}
          options={driveOptions}
        />

        {/* 应用计数 */}
        <div className="flex items-center gap-1 px-2 h-8 text-[12px] text-[var(--text-secondary)] bg-[var(--bg-hover)] rounded-md">
          <span className="font-semibold text-[var(--text-primary)]">{filteredApps.length}</span>
          <span>个</span>
        </div>
      </div>

      {/* 应用列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filteredApps.length > 0 ? (
          <div className="space-y-2 pb-2">
            {filteredApps.map((app, index) => (
              <AppRow 
                key={`${app.display_name}-${index}`} 
                app={app} 
                onMigrate={onMigrate}
                onRestore={onRestore}
                onUninstall={onUninstall}
                onOpenFolder={handleOpenFolder}
                isUninstalling={uninstallingKey === `${app.display_name}|${app.registry_path}`}
                isMigrated={isAppMigrated(app)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-hover)] flex items-center justify-center mb-3">
              <Search className="w-5 h-5 text-[var(--text-muted)]" />
            </div>
            <p className="text-[14px] font-medium text-[var(--text-primary)] mb-1">未找到匹配的应用</p>
            <p className="text-[12px] text-[var(--text-tertiary)]">尝试使用其他关键词搜索</p>
          </div>
        )}
      </div>
    </div>
  );
}
