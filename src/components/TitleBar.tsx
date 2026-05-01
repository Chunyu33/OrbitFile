// 自定义标题栏组件
// 集成 Tab 导航 + 磁盘状态 — 统一顶部栏，节省垂直空间

import { useState, type ReactNode } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ICON from "../assets/icon.svg"

interface TitleBarProps {
  centerContent?: ReactNode;
  rightContent?: ReactNode;
}

export default function TitleBar({ centerContent, rightContent }: TitleBarProps) {
  const appWindow = getCurrentWindow();
  const [closeHover, setCloseHover] = useState(false);
  const [minHover, setMinHover] = useState(false);
  const [maxHover, setMaxHover] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  // 监听窗口最大化状态变化（如双击标题栏触发）
  const updateMaximized = () => {
    appWindow.isMaximized().then(setIsMaximized);
  };
  // 初始检测一次
  updateMaximized();

  async function handleMinimize() {
    await appWindow.minimize();
  }

  async function handleToggleMaximize() {
    await appWindow.toggleMaximize();
    updateMaximized();
  }

  async function handleClose() {
    await appWindow.close();
  }

  return (
    <div
      data-tauri-drag-region
      className="flex items-center h-11 pl-3 pr-0 border-b select-none"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      {/* 左侧：Logo + 品牌名 */}
      <div data-tauri-drag-region className="flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center justify-center w-6 h-6">
          <img src={ICON} alt="" />
        </div>
        <span className="font-semibold text-[13px] tracking-tight" style={{ color: 'var(--text-primary)' }}>
          OrbitFile
        </span>
      </div>

      {/* 中间：Tab 导航（拖拽区域背景，Tab 按钮自动排除拖拽） */}
      <div data-tauri-drag-region className="flex-1 flex items-center justify-center">
        {centerContent}
      </div>

      {/* 右侧：磁盘状态 + 窗口控制 */}
      <div className="flex items-center h-full flex-shrink-0">
        {rightContent && (
          <div className="flex items-center pr-3">
            {rightContent}
          </div>
        )}

        <div className="flex items-center h-full">
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

          <button
            onClick={handleToggleMaximize}
            onMouseEnter={() => setMaxHover(true)}
            onMouseLeave={() => setMaxHover(false)}
            style={{
              width: '46px',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: maxHover ? 'var(--bg-hover)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
            }}
          >
            {isMaximized ? (
              <Copy style={{ width: '14px', height: '14px', color: 'var(--text-tertiary)' }} />
            ) : (
              <Square style={{ width: '14px', height: '14px', color: 'var(--text-tertiary)' }} />
            )}
          </button>

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
    </div>
  );
}
