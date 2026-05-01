// Toast 通知组件
// 使用全局 CSS 变量保持与主题配色一致

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  visible: boolean;
  onClose: () => void;
  duration?: number;
}

const typeColors = {
  success: {
    bg: 'var(--color-success-light)',
    border: 'var(--color-success)',
    text: 'var(--color-success)',
  },
  error: {
    bg: 'var(--color-danger-light)',
    border: 'var(--color-danger)',
    text: 'var(--color-danger)',
  },
  info: {
    bg: 'var(--color-primary-light)',
    border: 'var(--color-primary)',
    text: 'var(--color-primary)',
  },
} as const;

const typeIcon = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

export default function Toast({ message, type, visible, onClose, duration = 3000 }: ToastProps) {
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (visible && duration > 0) {
      const timer = setTimeout(() => {
        setIsLeaving(true);
        setTimeout(onClose, 200);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [visible, duration, onClose]);

  useEffect(() => {
    if (visible) setIsLeaving(false);
  }, [visible]);

  if (!visible) return null;

  const colors = typeColors[type];
  const Icon = typeIcon[type];

  return (
    <div className="fixed top-4 right-4 z-[100] pointer-events-none">
      <div
        className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-md border shadow-md transition-all duration-200 ease-out ${
          isLeaving ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'
        }`}
        style={{
          background: colors.bg,
          borderColor: colors.border,
        }}
      >
        <Icon className="w-5 h-5 flex-shrink-0" style={{ color: colors.text }} />
        <p className="text-sm font-medium max-w-[280px]" style={{ color: colors.text }}>{message}</p>
        <button
          onClick={() => { setIsLeaving(true); setTimeout(onClose, 200); }}
          className="w-6 h-6 flex items-center justify-center rounded-md transition-colors"
          style={{ color: colors.text }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{
    message: string;
    type: ToastType;
    visible: boolean;
  }>({ message: '', type: 'info', visible: false });

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    setToast({ message, type, visible: true });
  }, []);

  const hideToast = useCallback(() => {
    setToast(prev => ({ ...prev, visible: false }));
  }, []);

  return { toast, showToast, hideToast };
}
