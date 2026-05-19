// 自动更新检测 Hook
// 封装 @tauri-apps/plugin-updater 的 check / downloadAndInstall 流程，
// 提供状态、进度和版本信息供 UpdateNotification 组件消费

import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useState, useCallback, useRef } from 'react';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'up-to-date'
  | 'error';

export interface UpdateInfo {
  version: string;
  notes: string;
  pubDate: string;
}

export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // 保存 Update 对象引用，避免 downloadAndInstall 闭包过期
  const updateRef = useRef<Update | null>(null);

  const checkForUpdate = useCallback(async (): Promise<Update | null> => {
    setStatus('checking');
    setError(null);
    try {
      const update = await check();
      if (update?.available) {
        updateRef.current = update;
        setUpdateInfo({
          version: update.version,
          notes: update.body ?? '',
          pubDate: update.date ?? '',
        });
        setStatus('available');
        return update;
      } else {
        setStatus('up-to-date');
        return null;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('error');
      return null;
    }
  }, []);

  const downloadAndInstall = useCallback(async (update?: Update) => {
    const target = update ?? updateRef.current;
    if (!target) return;

    setStatus('downloading');
    setDownloadProgress(0);
    setError(null);
    try {
      let downloaded = 0;

      await target.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            // contentLength 可能为 null，此时不显示百分比
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            break;
          case 'Finished':
            setDownloadProgress(100);
            setStatus('installing');
            break;
        }
      });

      // 安装完成后重启应用
      await relaunch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('error');
    }
  }, []);

  const dismiss = useCallback(() => {
    setStatus('idle');
    setUpdateInfo(null);
    setError(null);
    setDownloadProgress(0);
  }, []);

  return {
    status,
    updateInfo,
    downloadProgress,
    error,
    updateRef,
    checkForUpdate,
    downloadAndInstall,
    dismiss,
  };
}
