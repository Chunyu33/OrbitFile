// 残留清理弹窗组件
// 极简风格：半透明背景 + 高对比风险操作按钮

import { useMemo } from 'react';
import { AlertTriangle, LoaderCircle, Trash2, X } from 'lucide-react';
import { LeftoverItem } from '../types';

interface CleanupModalProps {
  isOpen: boolean;
  appName: string;
  items: LeftoverItem[];
  loading: boolean;
  onClose: () => void;
  onToggleItem: (path: string) => void;
  onConfirm: () => void;
}

function formatItemSize(sizeMb: number): string {
  if (sizeMb <= 0) return '-';
  if (sizeMb < 1024) return `${sizeMb.toFixed(2)} MB`;
  return `${(sizeMb / 1024).toFixed(2)} GB`;
}

export default function CleanupModal({
  isOpen,
  appName,
  items,
  loading,
  onClose,
  onToggleItem,
  onConfirm,
}: CleanupModalProps) {
  const selectedCount = useMemo(() => items.filter((item) => item.selected).length, [items]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6 md:p-10">
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(15,23,42,0.42), rgba(2,6,23,0.62))',
          backdropFilter: 'blur(12px)',
        }}
        onClick={loading ? undefined : onClose}
      />

      <div
        className="relative w-full max-w-[860px] overflow-hidden rounded-2xl shadow-2xl animate-modal-in"
        style={{
          width: 'min(860px, calc(100vw - 48px))',
          background: 'color-mix(in srgb, var(--bg-modal) 92%, transparent)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div className="flex items-start justify-between px-7 pt-6 pb-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="pr-4">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>强力卸载 · 残留清理</h2>
            <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
              已检测到 <span style={{ fontWeight: 'var(--font-weight-semibold)' }}>{appName}</span> 的残留项目，请仅勾选确认可删除的条目
            </p>
            <div
              className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1"
              style={{ background: 'var(--color-warning-light)', color: 'var(--color-warning)' }}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' }}>
                删除后不可恢复，请谨慎操作
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="btn btn-ghost btn-icon"
            aria-label="关闭弹窗"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[460px] overflow-y-auto px-7 pt-6 pb-6">
          {items.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--spacing-8)' }}>
              <p className="empty-state-title">未发现可清理残留</p>
              <p className="empty-state-desc">该应用可能已完整卸载</p>
            </div>
          ) : (
            <div className="flex flex-col" style={{ gap: 'var(--spacing-3)' }}>
              {items.map((item) => (
                <label
                  key={item.path}
                  className="block rounded-xl border transition-all"
                  style={{
                    padding: '14px 16px',
                    borderColor: item.selected ? 'var(--color-primary)' : 'var(--border-color)',
                    background: item.selected ? 'var(--color-primary-light)' : 'var(--bg-card)',
                    boxShadow: item.selected ? '0 6px 16px -10px rgba(0,120,212,0.55)' : 'none',
                  }}
                >
                  <div className="flex items-start" style={{ gap: 'var(--spacing-3)' }}>
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => onToggleItem(item.path)}
                      disabled={loading}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between" style={{ gap: 'var(--spacing-3)' }}>
                        <div className="flex items-center" style={{ gap: 'var(--spacing-2)' }}>
                          <span className="badge badge-primary">{item.item_type}</span>
                          {item.selected && (
                            <span className="badge" style={{ background: 'var(--color-success-light)', color: 'var(--color-success)' }}>
                              已选中
                            </span>
                          )}
                        </div>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}>
                          {formatItemSize(item.size_mb)}
                        </span>
                      </div>
                      <p
                        className="mt-2 break-all"
                        style={{
                          color: 'var(--text-primary)',
                          fontSize: 'var(--font-size-xs)',
                          lineHeight: 'var(--line-height-relaxed)',
                        }}
                      >
                        {item.path}
                      </p>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-between px-7 pt-5 pb-5"
          style={{
            borderTop: '1px solid var(--border-color)',
            background: 'color-mix(in srgb, var(--color-gray-50) 74%, transparent)',
          }}
        >
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            已选中 {selectedCount} / {items.length} 项
          </p>
          <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
            <button className="btn btn-secondary" onClick={onClose} disabled={loading} style={{ minWidth: '88px' }}>
              取消
            </button>
            <button
              onClick={onConfirm}
              disabled={loading || selectedCount === 0}
              className="btn"
              style={{
                minWidth: '142px',
                background: 'var(--color-danger)',
                color: 'var(--text-inverse)',
                borderColor: 'var(--color-danger)',
                boxShadow: '0 10px 20px -12px rgba(220,38,38,0.85)',
              }}
            >
              {loading ? (
                <>
                  <LoaderCircle className="w-4 h-4 animate-spin" />
                  清理中...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  确认清理
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
