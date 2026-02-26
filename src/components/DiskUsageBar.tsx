// 磁盘使用情况组件
// 企业级模块化设计

import { HardDrive } from 'lucide-react';
import { DiskUsage } from '../types';

interface DiskUsageBarProps {
  diskUsage: DiskUsage | null;
  loading: boolean;
  compact?: boolean;
}

// 格式化字节数
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 根据使用率返回样式
function getProgressStyle(percent: number): { fillClass: string; iconBg: string; iconColor: string; textColor: string } {
  if (percent >= 90) {
    return {
      fillClass: 'progress-fill-danger',
      iconBg: 'var(--color-danger-light)',
      iconColor: 'var(--color-danger)',
      textColor: 'var(--color-danger)'
    };
  }
  if (percent >= 70) {
    return {
      fillClass: 'progress-fill-warning',
      iconBg: 'var(--color-warning-light)',
      iconColor: 'var(--color-warning)',
      textColor: 'var(--color-warning)'
    };
  }
  return {
    fillClass: 'progress-fill-safe',
    iconBg: 'var(--color-success-light)',
    iconColor: 'var(--color-success)',
    textColor: 'var(--color-success)'
  };
}

export default function DiskUsageBar({ diskUsage, loading, compact = false }: DiskUsageBarProps) {
  // 紧凑模式 - 内联显示
  if (compact) {
    if (loading) {
      return (
        <div className="flex items-center animate-pulse" style={{ gap: 'var(--spacing-2)' }}>
          <div className="w-24 h-2 rounded-full" style={{ background: 'var(--color-gray-200)' }}></div>
        </div>
      );
    }

    if (!diskUsage) {
      return (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>--</span>
      );
    }

    const usagePercent = diskUsage.usage_percent;
    const { fillClass, textColor } = getProgressStyle(usagePercent);

    return (
      <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
        {/* 紧凑进度条 */}
        <div className="progress-bar" style={{ width: '120px', height: '6px' }}>
          <div
            className={`progress-fill ${fillClass}`}
            style={{ width: `${Math.min(usagePercent, 100)}%` }}
          />
        </div>
        {/* 百分比 */}
        <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color: textColor }}>
          {usagePercent.toFixed(0)}%
        </span>
        {/* 可用空间 */}
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          可用 {formatBytes(diskUsage.free_space)}
        </span>
      </div>
    );
  }

  // 标准模式
  if (loading) {
    return (
      <div className="card" style={{ padding: 'var(--spacing-5)' }}>
        <div className="flex items-center gap-4 animate-pulse">
          <div className="w-12 h-12 rounded-lg" style={{ background: 'var(--color-gray-100)' }}></div>
          <div className="flex-1">
            <div className="h-4 rounded w-32 mb-3" style={{ background: 'var(--color-gray-100)' }}></div>
            <div className="h-2 rounded-full w-full" style={{ background: 'var(--color-gray-100)' }}></div>
          </div>
        </div>
      </div>
    );
  }

  if (!diskUsage) {
    return (
      <div className="card" style={{ padding: 'var(--spacing-5)' }}>
        <div className="flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
          <HardDrive className="w-5 h-5" />
          <span style={{ fontSize: 'var(--font-size-sm)' }}>无法获取磁盘信息</span>
        </div>
      </div>
    );
  }

  const usagePercent = diskUsage.usage_percent;
  const { fillClass, iconBg, iconColor, textColor } = getProgressStyle(usagePercent);

  return (
    <div className="card" style={{ padding: 'var(--spacing-5)' }}>
      <div className="flex items-center" style={{ gap: 'var(--spacing-4)' }}>
        {/* 图标 */}
        <div 
          className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: iconBg }}
        >
          <HardDrive className="w-6 h-6" style={{ color: iconColor }} />
        </div>

        {/* 信息区 */}
        <div className="flex-1 min-w-0">
          {/* 标题行 */}
          <div className="flex items-center justify-between" style={{ marginBottom: 'var(--spacing-2)' }}>
            <div className="flex items-center" style={{ gap: 'var(--spacing-2)' }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--font-size-sm)' }}>
                系统盘 (C:)
              </span>
            </div>
            <div className="flex items-center" style={{ gap: 'var(--spacing-2)' }}>
              <span style={{ fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-xl)', color: textColor }}>
                {usagePercent.toFixed(0)}%
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>已使用</span>
            </div>
          </div>
          
          {/* 进度条 */}
          <div className="progress-bar" style={{ marginBottom: 'var(--spacing-3)' }}>
            <div
              className={`progress-fill ${fillClass}`}
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
            />
          </div>

          {/* 容量信息 */}
          <div className="flex items-center" style={{ gap: 'var(--spacing-6)', fontSize: 'var(--font-size-xs)' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>
              已用 <span style={{ fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>{formatBytes(diskUsage.used_space)}</span>
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>
              可用 <span style={{ fontWeight: 'var(--font-weight-medium)', color: 'var(--color-success)' }}>{formatBytes(diskUsage.free_space)}</span>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              共 {formatBytes(diskUsage.total_space)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
