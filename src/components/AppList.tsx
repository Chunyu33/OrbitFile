// 应用列表组件
// 企业级模块化设计

import { Package, Search, CheckCircle2, FolderOpen, Link2 } from 'lucide-react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { InstalledApp } from '../types';
import { useState, useMemo } from 'react';

interface AppListProps {
  apps: InstalledApp[];
  loading: boolean;
  onMigrate: (app: InstalledApp) => void;
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

// 打开文件夹
async function openFolder(path: string) {
  try {
    await revealItemInDir(path);
  } catch (error) {
    console.error('打开文件夹失败:', error);
  }
}

// 应用卡片组件
function AppCard({ 
  app, 
  onMigrate, 
  isMigrated 
}: { 
  app: InstalledApp; 
  onMigrate: (app: InstalledApp) => void;
  isMigrated: boolean;
}) {
  const initial = app.display_name.charAt(0).toUpperCase();
  const bgColor = getAvatarColor(app.display_name, isMigrated);

  return (
    <div 
      className={`list-item ${isMigrated ? 'list-item-migrated' : ''}`}
      style={{ padding: 'var(--spacing-4)' }}
    >
      {/* 应用图标 */}
      <div 
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: bgColor }}
      >
        <span style={{ color: 'white', fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--font-size-sm)' }}>
          {initial}
        </span>
      </div>

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
          onClick={() => openFolder(app.install_location)}
          className="btn btn-icon btn-ghost"
          title="打开所在目录"
        >
          <FolderOpen className="w-4 h-4" />
        </button>

        {isMigrated ? (
          <span 
            className="btn"
            style={{ 
              background: 'var(--color-gray-100)', 
              color: 'var(--text-muted)',
              cursor: 'default',
              minWidth: '80px'
            }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />
            已完成
          </span>
        ) : (
          <button
            onClick={() => onMigrate(app)}
            className="btn btn-primary"
            style={{ minWidth: '80px' }}
          >
            迁移
          </button>
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

export default function AppList({ apps, loading, onMigrate, migratedPaths = [] }: AppListProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // 检查应用是否已迁移
  const isAppMigrated = (app: InstalledApp): boolean => {
    return migratedPaths.some(path => 
      path.toLowerCase() === app.install_location.toLowerCase()
    );
  };

  const filteredApps = useMemo(() => {
    if (!searchQuery.trim()) return apps;
    const query = searchQuery.toLowerCase();
    return apps.filter(app => 
      app.display_name.toLowerCase().includes(query) ||
      app.install_location.toLowerCase().includes(query)
    );
  }, [apps, searchQuery]);

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

  return (
    <div className="h-full flex flex-col">
      {/* 搜索栏 */}
      <div className="flex items-center" style={{ gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-4)' }}>
        <div className="relative flex-1">
          <Search 
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" 
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            placeholder="搜索应用名称或路径..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input"
            style={{ paddingLeft: 'var(--spacing-10)' }}
          />
        </div>
        <div 
          className="flex items-center flex-shrink-0"
          style={{ 
            gap: 'var(--spacing-2)', 
            padding: 'var(--spacing-2) var(--spacing-4)',
            background: 'var(--color-gray-100)',
            borderRadius: 'var(--radius-md)'
          }}
        >
          <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' }}>
            {filteredApps.length}
          </span>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}>个应用</span>
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
