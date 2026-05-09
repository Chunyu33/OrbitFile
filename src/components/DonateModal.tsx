// 赞赏弹窗组件
// 展示微信/支付宝赞赏码，支持切换；复用 MigrationModal 的过渡动画体系

import { useEffect, useState, useCallback } from 'react';
import { X, Heart } from 'lucide-react';
import WechatQR from '../assets/imgs/r_wechat_qr.jpg';
import AlipayQR from '../assets/imgs/r_alipay_qr.jpg';

interface DonateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type QRTab = 'wechat' | 'alipay';

const tabs: { key: QRTab; label: string; src: string; color: string }[] = [
  { key: 'wechat', label: '微信', src: WechatQR, color: '#07C160' },
  { key: 'alipay', label: '支付宝', src: AlipayQR, color: '#1677FF' },
];

export default function DonateModal({ isOpen, onClose }: DonateModalProps) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [tab, setTab] = useState<QRTab>('wechat');

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setLeaving(false);
    } else if (visible) {
      setLeaving(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setLeaving(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, visible]);

  const handleAnimatedClose = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      setVisible(false);
      setLeaving(false);
      onClose();
    }, 150);
  }, [onClose]);

  if (!visible) return null;

  const activeSrc = tabs.find(t => t.key === tab)?.src ?? WechatQR;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{
        animation: leaving ? 'fadeOut 150ms ease-in forwards' : 'fadeIn 150ms ease-out',
      }}
    >
      {/* 半透明遮罩 */}
      <div
        className="absolute inset-0"
        style={{
          background: 'var(--bg-modal-overlay)',
          backdropFilter: 'blur(8px)',
        }}
        onClick={handleAnimatedClose}
      />

      {/* 弹窗主体 */}
      <div
        className={`relative w-full overflow-hidden rounded-xl shadow-lg ${leaving ? 'animate-modal-out' : 'animate-modal-in'}`}
        style={{
          maxWidth: '360px',
          background: 'var(--bg-modal)',
          border: '1px solid var(--border-color)',
        }}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-5 pt-3.5 pb-3"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Heart className="h-4 w-4" style={{ color: 'var(--color-danger)' }} />
            支持作者
          </h2>
          <button onClick={handleAnimatedClose} className="btn btn-ghost btn-icon" aria-label="关闭">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-5 py-4">
          <p className="text-xs text-center mb-4" style={{ color: 'var(--text-secondary)' }}>
            如果 Viap 帮你省下了磁盘空间，欢迎请我喝杯咖啡 ☕️
          </p>

          {/* 滑块切换 — 微信绿 / 支付宝蓝 */}
          <div className="flex items-center justify-center mb-4">
            <div
              className="relative flex items-center rounded-full text-[12px] font-medium"
              style={{
                background: 'var(--bg-row-hover)',
                padding: '3px',
              }}
            >
              {/* 滑动背景块 */}
              <div
                className="absolute top-[3px] h-[28px] rounded-full transition-all duration-250 ease-out"
                style={{
                  left: tab === 'wechat' ? '3px' : 'calc(50% + 3px)',
                  width: 'calc(50% - 6px)',
                  background: tabs.find(t => t.key === tab)?.color ?? '#07C160',
                }}
              />
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="relative z-10 px-5 py-1.5 border-none cursor-pointer rounded-full transition-colors duration-200"
                  style={{
                    color: tab === t.key ? '#fff' : 'var(--text-tertiary)',
                    background: 'transparent',
                    minWidth: '80px',
                    textAlign: 'center',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* 赞赏码图片 — 确保扫码尺寸足够 */}
          <div className="flex items-center justify-center">
            <img
              src={activeSrc}
              alt={`${tab} 赞赏码`}
              className="rounded-lg"
              style={{
                width: '280px',
                height: '280px',
                objectFit: 'contain',
                background: '#fff',
              }}
            />
          </div>

          <p className="text-[10px] text-center mt-3" style={{ color: 'var(--text-tertiary)' }}>
            感谢你的支持！
          </p>
        </div>
      </div>
    </div>
  );
}
