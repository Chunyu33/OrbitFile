// 应用迁移页面
// 实现完整的迁移流程：目录选择 -> 进程检测 -> 文件复制 -> 创建链接

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { RefreshCw } from 'lucide-react';
import DiskUsageBar from '../components/DiskUsageBar';
import AppList from '../components/AppList';
import MigrationModal from '../components/MigrationModal';
import Toast, { useToast } from '../components/Toast';
import { DiskUsage, InstalledApp, MigrationResult, MigrationStep, ProcessLockResult } from '../types';

export default function AppMigration() {
  const [disks, setDisks] = useState<DiskUsage[]>([]);
  const [diskLoading, setDiskLoading] = useState(true);
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // 已迁移的路径列表
  const [migratedPaths, setMigratedPaths] = useState<string[]>([]);

  // 迁移状态
  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  const [migrationStep, setMigrationStep] = useState<MigrationStep>('idle');
  const [migratingApp, setMigratingApp] = useState<InstalledApp | null>(null);
  const [migrationMessage, setMigrationMessage] = useState('');
  const [lockedProcesses, setLockedProcesses] = useState<string[]>([]);
  
  // Toast 通知
  const { toast, showToast, hideToast } = useToast();

  async function fetchDiskUsage() {
    try {
      setDiskLoading(true);
      const diskList = await invoke<DiskUsage[]>('get_disk_usage');
      setDisks(diskList);
    } catch (error) {
      console.error('获取磁盘信息失败:', error);
      setDisks([]);
    } finally {
      setDiskLoading(false);
    }
  }

  async function fetchInstalledApps() {
    try {
      setAppsLoading(true);
      const installedApps = await invoke<InstalledApp[]>('get_installed_apps');
      setApps(installedApps);
    } catch (error) {
      console.error('获取应用列表失败:', error);
      setApps([]);
    } finally {
      setAppsLoading(false);
    }
  }

  // 获取已迁移的路径列表
  async function fetchMigratedPaths() {
    try {
      const paths = await invoke<string[]>('get_migrated_paths');
      setMigratedPaths(paths);
    } catch (error) {
      console.error('获取已迁移路径失败:', error);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([fetchDiskUsage(), fetchInstalledApps(), fetchMigratedPaths()]);
    setRefreshing(false);
  }

  // 核心迁移流程
  async function handleMigrate(app: InstalledApp) {
    // 步骤 1: 打开目录选择器，让用户选择目标文件夹
    const targetDir = await open({
      directory: true,
      multiple: false,
      title: `选择迁移目标文件夹 - ${app.display_name}`,
    });

    // 用户取消选择
    if (!targetDir) {
      return;
    }

    // 初始化迁移状态
    setMigratingApp(app);
    setMigrationModalOpen(true);
    setMigrationStep('checking');
    setMigrationMessage('');
    setLockedProcesses([]);

    try {
      // 步骤 2: 检查进程锁
      const lockResult = await invoke<ProcessLockResult>('check_process_locks', {
        sourcePath: app.install_location,
      });

      if (lockResult.is_locked) {
        // 发现进程占用，显示警告但继续执行
        setLockedProcesses(lockResult.processes);
        // 等待 2 秒让用户看到警告
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // 步骤 3: 开始复制文件
      setMigrationStep('copying');
      setLockedProcesses([]);

      // 步骤 4: 执行迁移（包含复制、校验、创建链接）
      setMigrationStep('linking');
      
      const result = await invoke<MigrationResult>('migrate_app', {
        appName: app.display_name,
        source: app.install_location,
        targetParent: targetDir,
      });

      // 步骤 5: 显示结果
      if (result.success) {
        setMigrationStep('success');
        setMigrationMessage(result.message);
        showToast('迁移成功！', 'success');
        // 刷新应用列表和磁盘信息
        await handleRefresh();
      } else {
        setMigrationStep('error');
        setMigrationMessage(result.message);
      }
    } catch (error) {
      setMigrationStep('error');
      setMigrationMessage(`迁移过程中发生错误: ${error}`);
    }
  }

  // 关闭迁移弹窗
  function handleCloseMigrationModal() {
    setMigrationModalOpen(false);
    setMigratingApp(null);
    setMigrationStep('idle');
    setMigrationMessage('');
    setLockedProcesses([]);
  }

  useEffect(() => {
    fetchDiskUsage();
    fetchInstalledApps();
    fetchMigratedPaths();
  }, []);

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ padding: 'var(--spacing-4) var(--spacing-5)' }}>
      <div className="h-full max-w-5xl mx-auto flex flex-col w-full" style={{ gap: 'var(--spacing-3)' }}>
        {/* 顶部：磁盘信息 + 刷新按钮 */}
        <header className="flex items-center justify-between flex-shrink-0" style={{ gap: 'var(--spacing-4)' }}>
          {/* 磁盘卡片横向滚动区域 */}
          <div className="flex-1 min-w-0">
            <DiskUsageBar disks={disks} loading={diskLoading} />
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn btn-secondary flex-shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </header>

        {/* 应用列表区域 - 占据剩余全部空间 */}
        <section className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <AppList 
            apps={apps} 
            loading={appsLoading} 
            onMigrate={handleMigrate}
            migratedPaths={migratedPaths}
          />
        </section>
      </div>

      {/* 迁移进度弹窗 */}
      <MigrationModal
        isOpen={migrationModalOpen}
        step={migrationStep}
        appName={migratingApp?.display_name || ''}
        message={migrationMessage}
        lockedProcesses={lockedProcesses}
        onClose={handleCloseMigrationModal}
      />

      {/* Toast 通知 */}
      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
        onClose={hideToast}
      />
    </div>
  );
}
