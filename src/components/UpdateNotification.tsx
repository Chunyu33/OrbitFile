// 自动更新通知组件
// 应用启动后静默检测更新，发现新版本后展示通知条；
// 下载时显示进度条，安装中提示重启；
// 自动检测失败时静默忽略，不展示错误提示

import { useEffect } from 'react';
import { useUpdater } from '../hooks/useUpdater';
import { ArrowDownToLine, Loader2, X } from 'lucide-react';

export default function UpdateNotification() {
  const {
    status, updateInfo, downloadProgress,
    checkForUpdate, downloadAndInstall, dismiss,
  } = useUpdater();

  // 启动后延迟检测更新，避免影响首屏性能
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdate();
    }, 3000);
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  if (status === 'idle' || status === 'checking' || status === 'up-to-date') {
    return null;
  }

  return (
    <>
      {/* 新版本可用 */}
      {status === 'available' && updateInfo && (
        <div className="update-banner" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px', background: 'var(--color-primary-light)',
          borderBottom: '1px solid var(--color-primary)',
        }}>
          <div className="flex items-center gap-3 min-w-0">
            <ArrowDownToLine className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-primary)' }} />
            <div className="min-w-0">
              <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                发现新版本 v{updateInfo.version}
              </span>
              {updateInfo.notes && (
                <span className="text-[11px] ml-2 truncate" style={{ color: 'var(--text-tertiary)' }}>
                  {updateInfo.notes}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={dismiss} className="btn h-7 text-[11px]">稍后再说</button>
            <button onClick={() => downloadAndInstall()} className="btn btn-primary h-7 text-[11px]">
              立即更新
            </button>
          </div>
        </div>
      )}

      {/* 下载中 */}
      {status === 'downloading' && (
        <div className="update-banner" style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '8px 16px', background: 'var(--color-primary-light)',
          borderBottom: '1px solid var(--color-primary)',
        }}>
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: 'var(--color-primary)' }} />
          <div className="flex-1 min-w-0">
            <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
              正在下载更新
            </span>
            {/* 进度条 */}
            <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-row-hover)' }}>
              <div className="h-full rounded-full transition-all duration-300" style={{
                width: `${downloadProgress > 0 ? downloadProgress : 5}%`,
                background: 'var(--color-primary)',
              }} />
            </div>
          </div>
          <button onClick={dismiss} className="btn btn-ghost btn-icon flex-shrink-0" title="取消">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 安装中 */}
      {status === 'installing' && (
        <div className="update-banner" style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 16px', background: 'var(--color-success-light)',
          borderBottom: '1px solid var(--color-success)',
        }}>
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: 'var(--color-success)' }} />
          <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
            正在安装，完成后将自动重启...
          </span>
        </div>
      )}

      {/* 自动检测失败时静默忽略，不展示任何提示 */}
    </>
  );
}
