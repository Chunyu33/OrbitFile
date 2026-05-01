// 迁移进度弹窗组件
// Windows 11 Fluent 风格 - 现代化状态反馈弹窗
// 支持真实进度条（从 Rust 后端实时推送）和取消操作

import {
  X,
  CheckCircle2,
  AlertTriangle,
  FolderSync,
  LoaderCircle,
  AlertCircle,
  Ban,
} from 'lucide-react';
import { MigrationStep } from '../types';

interface MigrationModalProps {
  isOpen: boolean;
  step: MigrationStep;
  appName: string;
  message: string;
  lockedProcesses: string[];
  // 真实进度百分比 0-100（来自后端 migration-progress 事件）
  progress: number;
  // 取消迁移回调
  onCancel?: () => void;
  // 强制继续（忽略进程锁）
  onForceContinue?: () => void;
  onClose: () => void;
}

// 步骤配置 - 仅用于状态标签和描述，进度值由后端事件覆盖
const stepConfig: Record<MigrationStep, { label: string; desc: string }> = {
  idle: { label: '准备中', desc: '正在初始化迁移任务...' },
  checking: { label: '检查进程', desc: '正在检查是否有程序占用文件' },
  counting: { label: '扫描文件', desc: '正在扫描待迁移的文件列表' },
  copying: { label: '复制文件', desc: '正在复制文件到目标位置，请勿关闭窗口' },
  verifying: { label: '校验完整性', desc: '正在校验文件完整性' },
  linking: { label: '创建链接', desc: '正在创建系统目录链接' },
  success: { label: '迁移完成', desc: '应用已成功迁移到新位置' },
  error: { label: '迁移失败', desc: '迁移过程中发生错误' },
};

export default function MigrationModal({
  isOpen,
  step,
  appName,
  message,
  lockedProcesses,
  progress,
  onCancel,
  onForceContinue,
  onClose,
}: MigrationModalProps) {
  if (!isOpen) return null;

  const config = stepConfig[step] || stepConfig.idle;
  const isLoading = ['checking', 'counting', 'copying', 'verifying', 'linking'].includes(step);
  const canClose = step === 'success' || step === 'error';
  const isSuccess = step === 'success';
  const isError = step === 'error';
  const hasProcessLocks = lockedProcesses.length > 0 && step === 'checking';

  // 统一使用后端推送的进度值，仅在未收到有效值时回退到估计值
  const displayProgress = progress >= 0 && progress <= 100 ? progress : 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6 md:p-10">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[12px]"
        onClick={canClose ? onClose : undefined}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-white/8 via-transparent to-black/12 pointer-events-none" />

      <div
        style={{
          width: 'min(520px, calc(100vw - 48px))',
          background: 'var(--bg-modal)',
          border: '1px solid var(--border-color)',
        }}
        className="relative w-full max-w-[520px] overflow-hidden rounded-2xl shadow-2xl animate-modal-in"
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-8 pt-5 pb-5"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: 'var(--color-primary)' }}
            >
              <FolderSync className="h-4.5 w-4.5 text-white" />
            </div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>应用迁移</h2>
          </div>
          {canClose && (
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
              style={{ color: 'var(--text-tertiary)' }}
              aria-label="关闭弹窗"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 核心内容区 */}
        <div className="px-5 pt-10 pb-10">
          {/* 应用名称区 */}
          <div className="mb-8 text-center">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              迁移目标应用
            </p>
            <p className="truncate text-[28px] font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
              {appName}
            </p>
          </div>

          {/* 状态指示区 */}
          <div className="mb-6 flex items-center justify-center gap-2">
            {isLoading && <LoaderCircle className="h-4 w-4 animate-spin" style={{ color: 'var(--color-primary)' }} />}
            {isSuccess && <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--color-success)' }} />}
            {isError && <AlertCircle className="h-4 w-4" style={{ color: 'var(--color-danger)' }} />}
            <span
              className="text-sm font-medium"
              style={{
                color: isSuccess
                  ? 'var(--color-success)'
                  : isError
                  ? 'var(--color-danger)'
                  : 'var(--color-primary)'
              }}
            >
              {config.label}
            </span>
          </div>

          {/* 状态描述 */}
          <p className="mb-6 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>{config.desc}</p>

          {/* 进度条（处理态 + 真实进度） */}
          {isLoading && (
            <div className="mb-6">
              <div className="h-1 overflow-hidden rounded-full" style={{ background: 'var(--color-gray-200)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${displayProgress}%`,
                    background: 'linear-gradient(90deg, var(--color-primary), var(--color-primary-hover))'
                  }}
                />
              </div>
              <p className="mt-2 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>{displayProgress.toFixed(0)}%</p>
            </div>
          )}

          {/* 成功态 */}
          {isSuccess && (
            <div
              className="mb-6 rounded-xl px-4 py-3 text-center"
              style={{ background: 'var(--color-success-light)' }}
            >
              <p className="text-sm" style={{ color: 'var(--color-success)' }}>
                迁移流程已完成，应用可从新位置正常运行。
              </p>
            </div>
          )}

          {/* 失败态 */}
          {isError && message && (
            <div className="mb-6 text-center">
              <p className="mb-2 text-sm font-medium" style={{ color: 'var(--color-danger)' }}>错误详情</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{message}</p>
            </div>
          )}

          {/* 进程锁警告（阻塞模式） */}
          {hasProcessLocks && (
            <div className="mb-6 rounded-xl p-4" style={{ background: 'var(--color-warning-light)' }}>
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: 'var(--color-warning)' }} />
                <div>
                  <p className="mb-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>检测到进程占用</p>
                  <p className="mb-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    以下程序正在使用该目录，请先关闭后再继续：
                  </p>
                  <ul className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {lockedProcesses.map((proc, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="h-1 w-1 rounded-full" style={{ background: 'var(--color-warning)' }} />
                        {proc}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作区 */}
        <div
          style={{
            borderTop: '1px solid var(--border-color)',
            background: 'var(--color-gray-50)'
          }}
          className="flex items-center justify-center gap-3 px-8 pt-5 pb-5"
        >
          {/* 处理态：取消按钮 */}
          {isLoading && onCancel && (
            <button
              onClick={onCancel}
              className="min-w-[120px] rounded-lg px-6 py-2.5 text-sm font-medium transition-all hover:scale-[1.02] active:scale-[0.98] inline-flex items-center justify-center gap-2"
              style={{
                background: 'var(--color-danger)',
                color: 'white',
              }}
            >
              <Ban className="w-4 h-4" />
              取消迁移
            </button>
          )}

          {/* 进程锁：强制继续按钮 */}
          {hasProcessLocks && onForceContinue && (
            <button
              onClick={onForceContinue}
              className="min-w-[120px] rounded-lg px-6 py-2.5 text-sm font-medium text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'var(--color-primary)' }}
            >
              强制继续
            </button>
          )}

          {/* 完成/错误态：关闭按钮 */}
          {canClose && (
            <button
              onClick={onClose}
              className="min-w-[120px] rounded-lg px-6 py-2.5 text-sm font-medium text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'var(--color-primary)' }}
            >
              {isSuccess ? '完成' : '我知道了'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
