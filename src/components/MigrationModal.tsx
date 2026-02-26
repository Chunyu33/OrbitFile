// 迁移进度弹窗组件
// Windows 11 风格 - 专业加载遮罩层

import { X, CheckCircle2, XCircle, AlertTriangle, FolderSync } from 'lucide-react';
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

// 步骤配置 - Windows 11 风格
const stepConfig = {
  idle: { label: '准备中', desc: '正在初始化迁移任务...', progress: 0 },
  checking: { label: '检查进程', desc: '正在检查是否有程序占用文件...', progress: 15 },
  copying: { label: '复制文件', desc: '正在将文件复制到目标位置，请勿关闭窗口...', progress: 50 },
  linking: { label: '创建链接', desc: '正在创建系统目录链接...', progress: 85 },
  success: { label: '迁移完成', desc: '应用已成功迁移到新位置', progress: 100 },
  error: { label: '迁移失败', desc: '迁移过程中发生错误', progress: 0 },
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 - 云母效果 */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-md"
        onClick={canClose ? onClose : undefined}
      />

      {/* 弹窗内容 - Windows 11 风格 */}
      <div className="relative bg-white rounded-xl shadow-2xl w-[480px] max-w-[90vw] overflow-hidden animate-fade-in">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F0F0]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#0078D4] rounded-lg flex items-center justify-center">
              <FolderSync className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-base font-semibold text-[#1A1A1A]">应用迁移</h2>
          </div>
          {canClose && (
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F0F0F0] transition-colors"
            >
              <X className="w-4 h-4 text-[#616161]" />
            </button>
          )}
        </div>

        {/* 内容区 */}
        <div className="px-6 py-6">
          {/* 应用名称 */}
          <div className="text-center mb-6">
            <p className="text-sm text-[#616161] mb-1">正在迁移</p>
            <p className="text-lg font-semibold text-[#1A1A1A] truncate">{appName}</p>
          </div>

          {/* 进度指示器 */}
          <div className="flex flex-col items-center mb-6">
            {/* 圆形进度 */}
            <div className={`relative w-20 h-20 mb-4 ${isLoading ? '' : ''}`}>
              {isLoading ? (
                <>
                  {/* 旋转动画圆环 */}
                  <svg className="w-20 h-20 animate-spin" viewBox="0 0 80 80">
                    <circle
                      cx="40" cy="40" r="34"
                      fill="none"
                      stroke="#F0F0F0"
                      strokeWidth="6"
                    />
                    <circle
                      cx="40" cy="40" r="34"
                      fill="none"
                      stroke="#0078D4"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray="160"
                      strokeDashoffset="120"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold text-[#0078D4]">{config.progress}%</span>
                  </div>
                </>
              ) : step === 'success' ? (
                <div className="w-20 h-20 bg-[#DFF6DD] rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-[#107C10]" />
                </div>
              ) : (
                <div className="w-20 h-20 bg-[#FDE7E5] rounded-full flex items-center justify-center">
                  <XCircle className="w-10 h-10 text-[#C42B1C]" />
                </div>
              )}
            </div>

            {/* 步骤标签 */}
            <p className={`text-sm font-semibold mb-1 ${
              step === 'success' ? 'text-[#107C10]' : 
              step === 'error' ? 'text-[#C42B1C]' : 
              'text-[#0078D4]'
            }`}>
              {config.label}
            </p>
            <p className="text-xs text-[#616161] text-center max-w-[280px]">
              {config.desc}
            </p>
          </div>

          {/* 进度条 */}
          {isLoading && (
            <div className="mb-4">
              <div className="h-1.5 bg-[#F0F0F0] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-[#0078D4] to-[#00BCF2] rounded-full transition-all duration-500"
                  style={{ width: `${config.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* 进程锁警告 */}
          {lockedProcesses.length > 0 && step === 'checking' && (
            <div className="bg-[#FFF4CE] border border-[#F7D154] rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-[#D83B01] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-[#323130] mb-1">检测到进程占用</p>
                  <p className="text-xs text-[#605E5C] mb-2">以下程序正在使用该目录，建议先关闭：</p>
                  <ul className="text-xs text-[#605E5C] space-y-1">
                    {lockedProcesses.map((proc, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-[#D83B01] rounded-full" />
                        {proc}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* 结果消息 */}
          {(step === 'success' || step === 'error') && message && (
            <div className={`rounded-lg p-4 ${
              step === 'success' 
                ? 'bg-[#DFF6DD] border border-[#9DE09D]' 
                : 'bg-[#FDE7E5] border border-[#F1BBBA]'
            }`}>
              <p className={`text-sm ${
                step === 'success' ? 'text-[#107C10]' : 'text-[#C42B1C]'
              }`}>
                {message}
              </p>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        {canClose && (
          <div className="px-6 py-4 bg-[#FAFAFA] border-t border-[#F0F0F0]">
            <button
              onClick={onClose}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
                step === 'success'
                  ? 'bg-[#107C10] text-white hover:bg-[#0E6B0E]'
                  : 'bg-[#E0E0E0] text-[#1A1A1A] hover:bg-[#D0D0D0]'
              }`}
            >
              {step === 'success' ? '完成' : '关闭'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
