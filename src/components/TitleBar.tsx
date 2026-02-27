// 自定义标题栏组件
// 实现窗口拖拽、最小化、关闭功能

import { Minus, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

// 应用图标 SVG 组件
function AppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="titleBarGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#3B82F6' }} />
          <stop offset="100%" style={{ stopColor: '#1D4ED8' }} />
        </linearGradient>
        <linearGradient id="titleBarArrow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#22C55E' }} />
          <stop offset="100%" style={{ stopColor: '#16A34A' }} />
        </linearGradient>
      </defs>
      <rect x="32" y="32" width="448" height="448" rx="96" ry="96" fill="url(#titleBarGradient)" />
      <ellipse cx="256" cy="256" rx="160" ry="160" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="24" />
      <ellipse cx="256" cy="256" rx="100" ry="100" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="16" />
      <g transform="translate(176, 180)">
        <path d="M0 40 L0 130 Q0 145 15 145 L145 145 Q160 145 160 130 L160 40 Q160 25 145 25 L80 25 L65 10 Q60 5 50 5 L15 5 Q0 5 0 20 Z" fill="white" />
        <path d="M0 20 Q0 5 15 5 L50 5 Q60 5 65 10 L80 25 L15 25 Q0 25 0 40 Z" fill="rgba(255,255,255,0.8)" />
      </g>
      <g transform="translate(340, 100)">
        <circle cx="30" cy="30" r="36" fill="url(#titleBarArrow)" />
        <path d="M18 30 L42 30 M32 20 L42 30 L32 40" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="416" cy="256" r="12" fill="white" opacity="0.9" />
      <circle cx="96" cy="256" r="8" fill="white" opacity="0.6" />
      <circle cx="256" cy="96" r="10" fill="white" opacity="0.7" />
      <circle cx="256" cy="416" r="8" fill="white" opacity="0.5" />
    </svg>
  );
}

export default function TitleBar() {
  const appWindow = getCurrentWindow();

  async function handleMinimize() {
    await appWindow.minimize();
  }

  async function handleClose() {
    await appWindow.close();
  }

  return (
    <div 
      data-tauri-drag-region
      style={{ paddingLeft: '12px' }}
      className="h-9 bg-white flex items-center justify-between pl-4 pr-0 border-b border-[#E5E5E5] select-none"
    >
      {/* 左侧 Logo */}
      <div data-tauri-drag-region className="flex items-center gap-2">
        <AppIcon />
        <span className="text-[#191919] font-medium text-sm">OrbitFile</span>
      </div>

      {/* 右侧窗口控制按钮 */}
      <div className="flex items-center">
        <button
          onClick={handleMinimize}
          className="w-11 h-9 flex items-center justify-center hover:bg-[#E5E5E5] transition-colors"
        >
          <Minus className="w-4 h-4 text-[#666666]" />
        </button>
        <button
          onClick={handleClose}
          className="w-11 h-9 flex items-center justify-center hover:bg-[#E81123] transition-colors group"
        >
          <X className="w-4 h-4 text-[#666666] group-hover:text-white" />
        </button>
      </div>
    </div>
  );
}
