// 自定义标题栏组件
// 实现窗口拖拽、最小化、关闭功能

import { useState } from 'react';
import { Minus, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ICON from "../assets/icon.svg"

// 应用图标 SVG 组件
function AppIcon() {
  return (
    <div className="flex items-center justify-center w-6 h-6">
      <img src={ICON} alt="" />
    </div>
  );
}

export default function TitleBar() {
  const appWindow = getCurrentWindow();
  const [closeHover, setCloseHover] = useState(false);
  const [minHover, setMinHover] = useState(false);

  async function handleMinimize() {
    await appWindow.minimize();
  }

  async function handleClose() {
    await appWindow.close();
  }

  return (
    <div 
      data-tauri-drag-region
      className="h-9 flex items-center justify-between pl-4 pr-0 border-b select-none"
      style={{ paddingLeft: '12px', background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      {/* 左侧 Logo */}
      <div data-tauri-drag-region className="flex items-center gap-2">
        <AppIcon />
        <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>OrbitFile</span>
      </div>

      {/* 右侧窗口控制按钮 */}
      <div className="flex items-center h-full">
        {/* 最小化按钮 */}
        <button
          onClick={handleMinimize}
          onMouseEnter={() => setMinHover(true)}
          onMouseLeave={() => setMinHover(false)}
          style={{
            width: '46px',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: minHover ? 'var(--bg-hover)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
        >
          <Minus style={{ width: '16px', height: '16px', color: 'var(--text-tertiary)' }} />
        </button>
        
        {/* 关闭按钮 */}
        <button
          onClick={handleClose}
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => setCloseHover(false)}
          style={{
            width: '46px',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: closeHover ? '#E81123' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
        >
          <X style={{ width: '16px', height: '16px', color: closeHover ? 'white' : 'var(--text-tertiary)', transition: 'color 0.15s ease' }} />
        </button>
      </div>
    </div>
  );
}
