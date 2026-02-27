// 迁移进度弹窗组件
// Windows 11 Fluent 风格 - 现代化状态反馈弹窗
//
// 视觉层次设计说明（中文）：
// ┌─────────────────────────────────────────────────────────────┐
// │ 一级层：标题栏 - 产品标识 + 关闭操作                           │
// │   - 左侧：品牌图标 + 标题文字                                  │
// │   - 右侧：关闭按钮（仅在可关闭状态显示）                        │
// ├─────────────────────────────────────────────────────────────┤
// │ 二级层：核心内容区 - 任务信息 + 状态反馈                        │
// │   - 应用名称：最大字号（28px），视觉焦点                        │
// │   - 状态指示：小图标 + 标签，柔和配色                           │
// │   - 进度条：细线条（4px），渐变色，平滑过渡                      │
// │   - 错误详情：纯文本排版，无边框，灰色次要信息                   │
// ├─────────────────────────────────────────────────────────────┤
// │ 三级层：操作区 - 主次按钮                                      │
// │   - 主按钮：实心填充，hover 微缩放                             │
// │   - 次按钮：描边样式，低视觉权重                               │
// └─────────────────────────────────────────────────────────────┘
//
// 色彩策略：
// - 禁止使用高饱和度颜色和粗边框（避免 Windows 98 风格）
// - 错误态：仅用 text-red-600 标记关键词，详情用 text-slate-500
// - 成功态：柔和绿色 emerald-600，不使用荧光绿
// - 处理态：品牌蓝 #0078D4，与 Windows 11 一致

import {
  X,
  CheckCircle2,
  AlertTriangle,
  FolderSync,
  LoaderCircle,
  AlertCircle,
} from 'lucide-react';
import { MigrationStep } from '../types';

interface MigrationModalProps {
  // 是否显示弹窗
  isOpen: boolean;
  // 当前迁移步骤
  step: MigrationStep;
  // 正在迁移的应用名称
  appName: string;
  // 结果消息（成功或失败时显示）
  message: string;
  // 被锁定的进程列表（检测到进程占用时显示）
  lockedProcesses: string[];
  // 关闭弹窗回调
  onClose: () => void;
  // 强制继续迁移（忽略进程锁警告）
  onForceClose?: () => void;
}

// 步骤配置 - 包含各阶段的显示文案和进度值
const stepConfig = {
  idle: {
    label: '准备中',
    desc: '正在初始化迁移任务...',
    progress: 5,
  },
  checking: {
    label: '检查进程',
    desc: '正在检查是否有程序占用文件',
    progress: 20,
  },
  copying: {
    label: '复制文件',
    desc: '正在复制文件到目标位置，请勿关闭窗口',
    progress: 50,
  },
  linking: {
    label: '创建链接',
    desc: '正在创建系统目录链接',
    progress: 85,
  },
  success: {
    label: '迁移完成',
    desc: '应用已成功迁移到新位置',
    progress: 100,
  },
  error: {
    label: '迁移失败',
    desc: '迁移过程中发生错误',
    progress: 0,
  },
};

export default function MigrationModal({
  isOpen,
  step,
  appName,
  message,
  lockedProcesses,
  onClose,
}: MigrationModalProps) {
  if (!isOpen) return null;

  const config = stepConfig[step];
  const isLoading = ['idle', 'checking', 'copying', 'linking'].includes(step);
  const canClose = step === 'success' || step === 'error';
  const isSuccess = step === 'success';
  const isError = step === 'error';

  return (
    // 全屏遮罩层 - 使用 grid 实现完美居中
    <div className="fixed inset-0 z-50 grid place-items-center p-4 sm:p-8">
      {/* 背景遮罩 - 双层叠加实现自然毛玻璃效果 */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-[12px]"
        onClick={canClose ? onClose : undefined}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-white/8 via-transparent to-black/12 pointer-events-none" />

      {/* 弹窗主体 - rounded-2xl (16px)，深阴影，入场动画 */}
      <div style={{ padding: '10px' }} className="relative w-full max-w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl animate-modal-in">
        
        {/* 一级层：标题栏 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0078D4]">
              <FolderSync className="h-4.5 w-4.5 text-white" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">应用迁移</h2>
          </div>
          {canClose && (
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600"
              aria-label="关闭弹窗"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 二级层：核心内容区 - 增加内边距到 p-10 */}
        <div style={{padding: '10px 0 10px 0'}} className="px-5 py-10">
          {/* 应用名称区：视觉焦点 */}
          <div className="mb-8 text-center">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">迁移目标应用</p>
            <p className="truncate text-[28px] font-bold leading-tight text-slate-900">{appName}</p>
          </div>

          {/* 状态指示区：小图标 + 标签 */}
          <div className="mb-6 flex items-center justify-center gap-2">
            {isLoading && <LoaderCircle className="h-4 w-4 animate-spin text-[#0078D4]" />}
            {isSuccess && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            {isError && <AlertCircle className="h-4 w-4 text-red-500" />}
            <span
              className={`text-sm font-medium ${
                isSuccess ? 'text-emerald-600' : isError ? 'text-red-600' : 'text-[#0078D4]'
              }`}
            >
              {config.label}
            </span>
          </div>

          {/* 状态描述 */}
          <p className="mb-6 text-center text-sm text-slate-500">{config.desc}</p>

          {/* 处理态：细进度条 (4px 高度) */}
          {isLoading && (
            <div className="mb-6">
              <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#0078D4] to-[#00BCF2] transition-all duration-700 ease-out"
                  style={{ width: `${config.progress}%` }}
                />
              </div>
              <p className="mt-2 text-center text-xs text-slate-400">{config.progress}%</p>
            </div>
          )}

          {/* 成功态：柔和绿色提示 */}
          {isSuccess && (
            <div className="mb-6 rounded-xl bg-emerald-50 px-4 py-3 text-center">
              <p className="text-sm text-emerald-700">迁移流程已完成，应用可从新位置正常运行。</p>
            </div>
          )}

          {/* 失败态：纯文本排版，无边框，无厚重红色块 */}
          {isError && message && (
            <div className="mb-6 text-center">
              {/* 错误类型标记 - 仅此处使用红色 */}
              <p className="mb-2 text-sm font-medium text-red-600">错误详情</p>
              {/* 错误详情 - 使用灰色次要文字 */}
              <p className="text-sm leading-relaxed text-slate-500">{message}</p>
            </div>
          )}

          {/* 进程锁警告 */}
          {lockedProcesses.length > 0 && step === 'checking' && (
            <div className="mb-6 rounded-xl bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                <div>
                  <p className="mb-1 text-sm font-medium text-amber-800">检测到进程占用</p>
                  <p className="mb-2 text-xs text-amber-700/80">以下程序正在使用该目录，建议先关闭：</p>
                  <ul className="space-y-1 text-xs text-amber-700">
                    {lockedProcesses.map((proc, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="h-1 w-1 rounded-full bg-amber-500" />
                        {proc}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 三级层：底部操作区 */}
        {canClose && (
          <div style={{padding: '10px 0 2px 0'}} className="flex items-center justify-center gap-3 border-t border-slate-100 bg-slate-50/50 px-8 py-5">
            <button
              onClick={onClose}
              className="min-w-[120px] rounded-lg bg-[#0078D4] px-6 py-2.5 text-sm font-medium text-blue transition-all hover:bg-[#106EBE] hover:scale-[1.02] active:scale-[0.98]"
            >
              {isSuccess ? '完成' : '我知道了'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
