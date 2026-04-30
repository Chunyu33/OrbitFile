// Toast 通知组件
// Windows 11 Fluent Design 风格

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  // 消息内容
  message: string;
  // 消息类型
  type: ToastType;
  // 是否显示
  visible: boolean;
  // 关闭回调
  onClose: () => void;
  // 自动关闭延迟（毫秒），默认 3000
  duration?: number;
}

// Windows 11 风格配置
const typeConfig = {
  success: {
    icon: CheckCircle2,
    bgColor: 'bg-[#DFF6DD]',
    borderColor: 'border-[#9DE09D]',
    iconColor: 'text-[#107C10]',
    textColor: 'text-[#107C10]',
  },
  error: {
    icon: XCircle,
    bgColor: 'bg-[#FDE7E5]',
    borderColor: 'border-[#F1BBBA]',
    iconColor: 'text-[#C42B1C]',
    textColor: 'text-[#C42B1C]',
  },
  info: {
    icon: Info,
    bgColor: 'bg-[#E6F2FB]',
    borderColor: 'border-[#B3D7F2]',
    iconColor: 'text-[#0078D4]',
    textColor: 'text-[#0078D4]',
  },
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
    if (visible) {
      setIsLeaving(false);
    }
  }, [visible]);

  if (!visible) return null;

  const config = typeConfig[type];
  const Icon = config.icon;

  return (
    <div className="fixed top-4 right-4 z-[100] pointer-events-none">
      <div
        className={`
          pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg
          ${config.bgColor} ${config.borderColor}
          transition-all duration-200 ease-out
          ${isLeaving ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}
        `}
      >
        <Icon className={`w-5 h-5 flex-shrink-0 ${config.iconColor}`} />
        <p className={`text-sm font-medium ${config.textColor} max-w-[280px]`}>{message}</p>
        <button
          onClick={() => {
            setIsLeaving(true);
            setTimeout(onClose, 200);
          }}
          className={`w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 transition-colors ${config.textColor}`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Toast 管理 Hook
export function useToast() {
  const [toast, setToast] = useState<{
    message: string;
    type: ToastType;
    visible: boolean;
  }>({
    message: '',
    type: 'info',
    visible: false,
  });

  // showToast 用 useCallback 稳定引用，防止消费方因依赖变化导致无限重渲染
  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    setToast({ message, type, visible: true });
  }, []);

  const hideToast = useCallback(() => {
    setToast(prev => ({ ...prev, visible: false }));
  }, []);

  return { toast, showToast, hideToast };
}
