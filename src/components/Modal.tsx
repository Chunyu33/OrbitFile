// 通用弹窗组件 — 桌面工具风格
// 支持打开/关闭过渡动画

import { ReactNode, useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: number;
}

export default function Modal({ isOpen, onClose, title, children, width = 640 }: ModalProps) {
  // 动画状态：entering / open / leaving / closed
  const [phase, setPhase] = useState<'closed' | 'entering' | 'open' | 'leaving'>('closed');

  useEffect(() => {
    if (isOpen && phase === 'closed') {
      // 下一帧触发进入动画
      requestAnimationFrame(() => setPhase('entering'));
      requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
    }
    if (!isOpen && phase === 'open') {
      setPhase('leaving');
      const timer = setTimeout(() => setPhase('closed'), 180);
      return () => clearTimeout(timer);
    }
  }, [isOpen, phase]);

  // 如果外部 isOpen 变为 false 但我们还在 leaving 动画中，不要立即卸载
  useEffect(() => {
    if (!isOpen && phase === 'closed') {
      // 已经关闭完成，什么都不做
    }
  }, [isOpen, phase]);

  const handleClose = useCallback(() => {
    if (phase === 'open') {
      setPhase('leaving');
      setTimeout(() => {
        setPhase('closed');
        onClose();
      }, 180);
    }
  }, [phase, onClose]);

  if (phase === 'closed') return null;

  const overlayStyle: React.CSSProperties = {
    background: 'var(--bg-modal-overlay)',
    opacity: phase === 'open' ? 1 : 0,
    transition: 'opacity 180ms ease-out',
  };

  const panelStyle: React.CSSProperties = {
    width: `min(${width}px, calc(100vw - 48px))`,
    maxHeight: 'min(640px, calc(100vh - 80px))',
    background: 'var(--bg-modal)',
    border: '1px solid var(--border-color)',
    boxShadow: 'var(--shadow-lg)',
    transform: phase === 'open' ? 'scale(1)' : 'scale(0.96)',
    opacity: phase === 'open' ? 1 : 0,
    transition: 'transform 180ms ease-out, opacity 180ms ease-out',
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={overlayStyle}
      onClick={handleClose}
    >
      <div
        className="rounded-lg flex flex-col overflow-hidden"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between flex-shrink-0 px-5 py-3"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title ?? ''}
          </h2>
          <button
            onClick={handleClose}
            className="btn btn-ghost btn-icon w-7 h-7"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
