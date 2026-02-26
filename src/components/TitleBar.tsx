// 自定义标题栏组件
// 实现窗口拖拽、最小化、关闭功能

import { Minus, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

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
      style={{
        paddingLeft: '12px',
      }}
      className="h-9 bg-white flex items-center justify-between pl-4 pr-0 border-b border-[#E5E5E5] select-none"
    >
      {/* 左侧 Logo */}
      <div data-tauri-drag-region className="flex items-center gap-2">
        <div className="w-5 h-5 rounded bg-[#07C160] flex items-center justify-center">
          <span className="text-white font-bold text-xs">O</span>
        </div>
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
          className="w-11 h-9 flex items-center justify-center hover:bg-[#E81123] hover:text-white transition-colors group"
        >
          <X className="w-4 h-4 text-[#666666] group-hover:text-red" />
        </button>
      </div>
    </div>
  );
}
