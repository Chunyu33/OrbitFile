// 应用列表组件
// 企业级模块化设计

import { Package, Search, CheckCircle2, FolderOpen, Link2 } from 'lucide-react';
import { InstalledApp } from '../types';
import { useState, useMemo } from 'react';

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

// 应用卡片组件
function AppCard({ 
  app, 
  onMigrate, 
  onRestore,
  onUninstall,
  onOpenFolder,
  isUninstalling,
  isMigrated 
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
    <div 
      className={`list-item ${isMigrated ? 'list-item-migrated' : ''}`}
      style={{ padding: 'var(--spacing-4)' }}
    >
      {/* 应用图标 */}
      <AppIcon app={app} isMigrated={isMigrated} />

      {/* 应用信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center" style={{ gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-1)' }}>
          <h3 
            className="truncate" 
            title={app.display_name}
            style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' }}
          >
            {app.display_name}
          </h3>
          {isMigrated && (
            <span className="badge badge-success">
              <Link2 className="w-3 h-3" />
              已链接
            </span>
          )}
        </div>
        <p 
          className="truncate" 
          title={app.install_location}
          style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}
        >
          {app.install_location}
        </p>
      </div>

      {/* 大小 */}
      <div className="flex-shrink-0 text-right" style={{ minWidth: '80px' }}>
        <div style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' }}>
          {formatSize(app.estimated_size)}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center flex-shrink-0" style={{ gap: 'var(--spacing-2)' }}>
        <button
          onClick={() => onOpenFolder(app)}
          className="btn btn-icon btn-ghost"
          title="打开所在目录"
        >
          <FolderOpen className="w-4 h-4" />
        </button>

        {isMigrated ? (
          <>
            <button
              onClick={() => onRestore(app)}
              className="btn btn-secondary"
              style={{ minWidth: '80px' }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />
              还原
            </button>
            <button
              onClick={() => onUninstall(app)}
              className="btn btn-secondary"
              disabled={isUninstalling}
              style={{ minWidth: '96px' }}
            >
              {isUninstalling ? '卸载中...' : '强力卸载'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onMigrate(app)}
              className="btn btn-primary"
              style={{ minWidth: '80px' }}
            >
              迁移
            </button>
            <button
              onClick={() => onUninstall(app)}
              className="btn btn-secondary"
              disabled={isUninstalling}
              style={{ minWidth: '96px' }}
            >
              {isUninstalling ? '卸载中...' : '强力卸载'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// 加载骨架屏
function LoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div 
          key={i} 
          className="card animate-pulse"
          style={{ padding: 'var(--spacing-4)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-4)' }}
        >
          <div className="w-10 h-10 rounded-lg" style={{ background: 'var(--color-gray-100)' }}></div>
          <div className="flex-1">
            <div className="h-4 rounded w-40 mb-2" style={{ background: 'var(--color-gray-100)' }}></div>
            <div className="h-3 rounded w-56" style={{ background: 'var(--color-gray-100)' }}></div>
          </div>
          <div className="w-20 h-8 rounded-md" style={{ background: 'var(--color-gray-100)' }}></div>
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

  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center mb-4" style={{ gap: 'var(--spacing-2)', color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
          <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}></div>
          <span>正在扫描应用...</span>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <Package className="w-8 h-8" />
        </div>
        <p className="empty-state-title">未找到可迁移的应用</p>
        <p className="empty-state-desc">请确保 C 盘有已安装的应用程序</p>
      </div>
    );
  }

  // 下拉选择框样式
  const selectStyle: React.CSSProperties = {
    appearance: 'none',
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    padding: '6px 28px 6px 10px',
    fontSize: 'var(--font-size-xs)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    minWidth: '90px',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
  };

  return (
    <div className="h-full flex flex-col">
      {/* 搜索栏与筛选器 */}
      <div className="flex items-center" style={{ gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-4)' }}>
        {/* 搜索框 */}
        <div className="relative" style={{ flex: '1 1 auto', minWidth: 0 }}>
          <Search 
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" 
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            placeholder="搜索应用..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input"
            style={{ paddingLeft: 'var(--spacing-10)', width: '100%' }}
          />
        </div>

        {/* 迁移状态筛选 */}
        <select
          value={migrationFilter}
          onChange={(e) => setMigrationFilter(e.target.value as MigrationFilter)}
          style={selectStyle}
          title="按迁移状态筛选"
        >
          <option value="all">全部状态</option>
          <option value="migrated">已迁移</option>
          <option value="not_migrated">未迁移</option>
        </select>

        {/* 盘符筛选 */}
        <select
          value={driveFilter}
          onChange={(e) => setDriveFilter(e.target.value as DriveFilter)}
          style={selectStyle}
          title="按安装盘符筛选"
        >
          <option value="all">全部盘</option>
          <option value="c">C 盘</option>
          <option value="other">其他盘{otherDrives.length > 0 ? ` (${otherDrives.join('/')})` : ''}</option>
        </select>

        {/* 应用计数 */}
        <div 
          className="flex items-center flex-shrink-0"
          style={{ 
            gap: 'var(--spacing-1)', 
            padding: '6px 10px',
            background: 'var(--color-gray-100)',
            borderRadius: 'var(--radius-md)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' }}>
            {filteredApps.length}
          </span>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}>个</span>
        </div>
      </div>

      {/* 应用列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ paddingRight: 'var(--spacing-2)' }}>
        {filteredApps.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
            {filteredApps.map((app, index) => (
              <AppCard 
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
          <div className="empty-state">
            <div className="empty-state-icon">
              <Search className="w-6 h-6" />
            </div>
            <p className="empty-state-title">未找到匹配的应用</p>
            <p className="empty-state-desc">尝试使用其他关键词搜索</p>
          </div>
        )}
      </div>
    </div>
  );
}
