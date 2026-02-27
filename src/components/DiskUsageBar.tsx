// 磁盘使用情况组件
// 显示所有磁盘，支持横向滚动

import { useMemo } from 'react';
import { HardDrive } from 'lucide-react';
import { DiskUsage } from '../types';

interface DiskUsageBarProps {
  disks: DiskUsage[];
  loading: boolean;
}

// 格式化字节数为简短格式
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 根据使用率返回颜色
function getUsageColor(percent: number): string {
  if (percent >= 90) return 'var(--color-danger)';
  if (percent >= 70) return 'var(--color-warning)';
  return 'var(--color-primary)';
}

// 单个磁盘卡片组件
const DiskCard = ({ disk }: { disk: DiskUsage }) => {
  const usageColor = useMemo(() => getUsageColor(disk.usage_percent), [disk.usage_percent]);
  const displayName = disk.mount_point.replace(':\\', '');
  
  return (
    <div
      style={{
        minWidth: '140px',
        padding: '12px 16px',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* 磁盘标识 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            width: '28px',
            height: '28px',
            borderRadius: 'var(--radius-md)',
            background: disk.is_system ? 'var(--color-primary-light)' : 'var(--color-gray-100)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <HardDrive 
            style={{ 
              width: '14px', 
              height: '14px', 
              color: disk.is_system ? 'var(--color-primary)' : 'var(--text-tertiary)' 
            }} 
          />
        </div>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {displayName}:
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {disk.name}
          </div>
        </div>
      </div>
      
      {/* 进度条 */}
      <div
        style={{
          height: '6px',
          background: 'var(--color-gray-100)',
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(disk.usage_percent, 100)}%`,
            background: usageColor,
            borderRadius: '3px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      
      {/* 容量信息 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
          可用 {formatBytes(disk.free_space)}
        </span>
        <span style={{ fontSize: '12px', fontWeight: 600, color: usageColor }}>
          {disk.usage_percent.toFixed(0)}%
        </span>
      </div>
    </div>
  );
};

// 加载骨架屏
const DiskSkeleton = () => (
  <div
    style={{
      minWidth: '140px',
      padding: '12px 16px',
      background: 'var(--bg-card)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}
    className="animate-pulse"
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-md)', background: 'var(--color-gray-100)' }} />
      <div>
        <div style={{ width: '32px', height: '14px', borderRadius: '4px', background: 'var(--color-gray-100)' }} />
        <div style={{ width: '48px', height: '10px', borderRadius: '4px', background: 'var(--color-gray-100)', marginTop: '4px' }} />
      </div>
    </div>
    <div style={{ height: '6px', borderRadius: '3px', background: 'var(--color-gray-100)' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <div style={{ width: '60px', height: '12px', borderRadius: '4px', background: 'var(--color-gray-100)' }} />
      <div style={{ width: '28px', height: '12px', borderRadius: '4px', background: 'var(--color-gray-100)' }} />
    </div>
  </div>
);

export default function DiskUsageBar({ disks, loading }: DiskUsageBarProps) {
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          gap: '12px',
          overflowX: 'auto',
          paddingBottom: '4px',
          scrollbarWidth: 'thin',
        }}
      >
        {[1, 2, 3].map((i) => (
          <DiskSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!disks || disks.length === 0) {
    return (
      <div
        style={{
          padding: '16px',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: 'var(--text-tertiary)',
        }}
      >
        <HardDrive style={{ width: '16px', height: '16px' }} />
        <span style={{ fontSize: '13px' }}>无法获取磁盘信息</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: '12px',
        overflowX: 'auto',
        paddingBottom: '4px',
        scrollbarWidth: 'thin',
      }}
    >
      {disks.map((disk) => (
        <DiskCard key={disk.mount_point} disk={disk} />
      ))}
    </div>
  );
}
