// 应用迁移页面
// 实现完整的迁移流程：目录选择 -> 进程检测 -> 文件复制 -> 创建链接

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import AppList from '../components/AppList';
import MigrationModal from '../components/MigrationModal';
import CleanupModal from '../components/CleanupModal';
import Toast, { useToast } from '../components/Toast';
import { CleanupResult, InstalledApp, LeftoverItem, MigrationRecord, MigrationResult, MigrationStep, ProcessLockResult, UninstallResult } from '../types';

export default function AppMigration() {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  
  // 已迁移的路径列表
  const [migratedPaths, setMigratedPaths] = useState<string[]>([]);
  // 应用迁移记录（用于还原时获取 historyId）
  const [appMigrationRecords, setAppMigrationRecords] = useState<MigrationRecord[]>([]);

  // 迁移状态
  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  const [migrationStep, setMigrationStep] = useState<MigrationStep>('idle');
  const [migratingApp, setMigratingApp] = useState<InstalledApp | null>(null);
  const [migrationMessage, setMigrationMessage] = useState('');
  const [lockedProcesses, setLockedProcesses] = useState<string[]>([]);

  // 强力卸载状态
  const [uninstallingKey, setUninstallingKey] = useState<string | null>(null);
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [cleanupTargetAppName, setCleanupTargetAppName] = useState('');
  const [cleanupTargetPublisher, setCleanupTargetPublisher] = useState<string | null>(null);
  const [leftoverItems, setLeftoverItems] = useState<LeftoverItem[]>([]);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  
  // Toast 通知
  const { toast, showToast, hideToast } = useToast();

  // 手动触发残留扫描
  async function handleScanResidue(app: InstalledApp) {
    try {
      const leftovers = await invoke<LeftoverItem[]>('scan_app_residue', {
        appName: app.display_name,
        publisher: app.publisher || null,
        installLocation: app.install_location || null,
      });

      if (leftovers.length > 0) {
        setCleanupTargetAppName(app.display_name);
        setCleanupTargetPublisher(app.publisher || null);
        setLeftoverItems(leftovers);
        setCleanupModalOpen(true);
      } else {
        showToast(`${app.display_name} 未检测到残留`, 'success');
        await handleRefresh();
      }
    } catch (error) {
      showToast(`残留扫描失败: ${error}`, 'error');
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

  // 获取应用迁移记录，并同步已迁移路径
  async function fetchAppMigrationRecords() {
    try {
      const records = await invoke<MigrationRecord[]>('get_migration_history');
      const appRecords = records.filter(record => record.record_type === 'App');
      setAppMigrationRecords(appRecords);
      setMigratedPaths(appRecords.map(record => record.original_path));
    } catch (error) {
      console.error('获取应用迁移记录失败:', error);
      setAppMigrationRecords([]);
      setMigratedPaths([]);
    }
  }

  async function handleRefresh() {
    await Promise.all([fetchInstalledApps(), fetchAppMigrationRecords()]);
  }

  // 还原流程：将已迁移应用恢复到原始位置
  async function handleRestore(app: InstalledApp) {
    const record = appMigrationRecords.find(r =>
      r.original_path.toLowerCase() === app.install_location.toLowerCase()
    );

    if (!record) {
      showToast('未找到该应用的迁移记录，无法执行还原', 'error');
      return;
    }

    try {
      const result = await invoke<MigrationResult>('restore_app', {
        historyId: record.id,
      });

      if (result.success) {
        showToast(`${app.display_name} 已成功还原`, 'success');
        await handleRefresh();
      } else {
        showToast(result.message || '还原失败', 'error');
      }
    } catch (error) {
      showToast(`还原失败: ${error}`, 'error');
    }
  }

  // 强力卸载流程
  async function handleUninstall(app: InstalledApp) {
    const confirmed = await confirm(
      `即将启动 ${app.display_name} 的卸载程序。\n\n此操作可能删除应用及其相关组件，是否继续？`,
      {
        title: '确认强力卸载',
        kind: 'warning',
        okLabel: '继续卸载',
        cancelLabel: '取消',
      }
    );

    if (!confirmed) {
      return;
    }

    const currentUninstallKey = `${app.display_name}|${app.registry_path}`;

    try {
      setUninstallingKey(currentUninstallKey);

      const result = await invoke<UninstallResult>('uninstall_application', {
        input: {
          app_id: app.display_name,
          registry_path: app.registry_path,
        },
      });

      if (result.success) {
        showToast(result.message || `${app.display_name} 卸载流程已完成`, 'success');

        const confirmScan = await confirm(
          `${app.display_name} 卸载流程已结束。\n\n是否现在开始残留扫描？（建议在卸载向导完全关闭后执行）`,
          {
            title: '手动确认残留扫描',
            kind: 'warning',
            okLabel: '开始扫描',
            cancelLabel: '稍后再说',
          }
        );

        if (confirmScan) {
          await handleScanResidue(app);
        } else {
          await handleRefresh();
        }
      } else {
        showToast(result.message || '启动卸载失败', 'error');
      }
    } catch (error) {
      showToast(`卸载未完成：${error}`, 'error');
    } finally {
      setUninstallingKey(null);
    }
  }

  // 切换残留项选中状态
  function handleToggleLeftover(path: string) {
    setLeftoverItems((prev) =>
      prev.map((item) =>
        item.path === path
          ? { ...item, selected: !item.selected }
          : item
      )
    );
  }

  // 执行清理
  async function handleConfirmCleanup() {
    const selectedPaths = leftoverItems
      .filter((item) => item.selected)
      .map((item) => item.path);

    if (selectedPaths.length === 0) {
      showToast('请至少选择一项残留再进行清理', 'error');
      return;
    }

    try {
      setCleanupLoading(true);
      const result = await invoke<CleanupResult>('execute_cleanup', {
        items: selectedPaths,
        appName: cleanupTargetAppName || null,
        publisher: cleanupTargetPublisher,
      });

      if (result.success) {
        showToast('清理成功', 'success');
      } else {
        showToast(result.message || '部分项目清理失败，请重试', 'error');
      }

      setCleanupModalOpen(false);
      setLeftoverItems([]);
      setCleanupTargetAppName('');
      setCleanupTargetPublisher(null);
      await handleRefresh();
    } catch (error) {
      showToast(`执行清理失败: ${error}`, 'error');
    } finally {
      setCleanupLoading(false);
    }
  }

  // 关闭清理弹窗
  function handleCloseCleanupModal() {
    if (cleanupLoading) {
      return;
    }

    setCleanupModalOpen(false);
    setLeftoverItems([]);
    setCleanupTargetAppName('');
    setCleanupTargetPublisher(null);
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
    fetchInstalledApps();
    fetchAppMigrationRecords();
  }, []);

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ padding: 'var(--spacing-4) var(--spacing-5)' }}>
      <div className="h-full max-w-5xl mx-auto w-full">
        {/* 应用列表区域 - 占据全部空间 */}
        <section className="h-full min-h-0 flex flex-col overflow-hidden">
          <AppList 
            apps={apps} 
            loading={appsLoading} 
            onMigrate={handleMigrate}
            onRestore={handleRestore}
            onUninstall={handleUninstall}
            uninstallingKey={uninstallingKey}
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

      {/* 强力卸载残留清理弹窗 */}
      <CleanupModal
        isOpen={cleanupModalOpen}
        appName={cleanupTargetAppName}
        items={leftoverItems}
        loading={cleanupLoading}
        onClose={handleCloseCleanupModal}
        onToggleItem={handleToggleLeftover}
        onConfirm={handleConfirmCleanup}
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
