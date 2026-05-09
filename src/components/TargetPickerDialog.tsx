// 迁移目标选择弹窗
// 替代原生 confirm：区分「使用默认」「自定义目录」和「X 取消」三个操作
// 复用 DonateModal/MigrationModal 的过渡动画体系

import { useEffect, useState, useCallback } from 'react';
import { X, FolderCheck, FolderSearch } from 'lucide-react';

export interface TargetPickerDialogProps {
  isOpen: boolean;
  title: string;
  defaultPath: string;
  itemName: string;
  onUseDefault: () => void;
  onUseCustom: () => void;
  onClose: () => void;
}

export default function TargetPickerDialog({
  isOpen, title, defaultPath, itemName,
  onUseDefault, onUseCustom, onClose,
}: TargetPickerDialogProps) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setLeaving(false);
    } else if (visible) {
      setLeaving(true);
      const timer = setTimeout(() => { setVisible(false); setLeaving(false); }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, visible]);

  const handleClose = useCallback(() => {
    setLeaving(true);
    setTimeout(() => { setVisible(false); setLeaving(false); onClose(); }, 150);
  }, [onClose]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ animation: leaving ? 'fadeOut 150ms ease-in forwards' : 'fadeIn 150ms ease-out' }}
    >
      {/* 半透明遮罩 — 点击不关闭，必须显式操作 */}
      <div
        className="absolute inset-0"
        style={{ background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(8px)' }}
      />

      <div
        className={`relative w-full overflow-hidden rounded-xl shadow-lg ${leaving ? 'animate-modal-out' : 'animate-modal-in'}`}
        style={{ maxWidth: '400px', background: 'var(--bg-modal)', border: '1px solid var(--border-color)' }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 pt-3.5 pb-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={handleClose} className="btn btn-ghost btn-icon" aria-label="关闭">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-5 py-4">
          <p className="text-xs text-center mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {itemName}
          </p>

          <div
            className="rounded-lg p-3 mb-4 text-center"
            style={{ background: 'var(--color-primary-light)' }}
          >
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>默认迁移目录</p>
            <p className="text-xs font-medium font-mono mt-0.5" style={{ color: 'var(--text-primary)' }}>
              {defaultPath}
            </p>
          </div>

          {/* 两个操作按钮 */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => { setLeaving(true); setTimeout(() => { setVisible(false); setLeaving(false); onUseDefault(); }, 150); }}
              className="btn h-9 text-[12px] w-full flex items-center justify-center gap-2"
              style={{ background: 'var(--color-primary)', color: 'var(--text-inverse)', borderColor: 'var(--color-primary)' }}
            >
              <FolderCheck className="w-4 h-4" />
              使用默认位置
            </button>
            <button
              onClick={() => { setLeaving(true); setTimeout(() => { setVisible(false); setLeaving(false); onUseCustom(); }, 150); }}
              className="btn h-9 text-[12px] w-full flex items-center justify-center gap-2"
            >
              <FolderSearch className="w-4 h-4" />
              自定义目录
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
