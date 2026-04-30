// OrbitFile - 主应用组件
// 企业级模块化设计
// 集成主题系统，支持浅色/深色/跟随系统三种模式

import { useEffect, useState, createContext, useContext } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FolderSync, FolderArchive, History, Settings as SettingsIcon } from 'lucide-react';
import TitleBar from './components/TitleBar';
import DiskUsageBar from './components/DiskUsageBar';
import PageTransition from './components/PageTransition';
import AppMigration from './pages/AppMigration';
import LargeFolders from './pages/LargeFolders';
import MigrationHistory from './pages/MigrationHistory';
import Settings from './pages/Settings';
import { DiskUsage, TabType } from './types';
import { useTheme, ThemeMode, ResolvedTheme } from './hooks/useTheme';
import './App.css';

// 主题上下文 - 供子组件访问主题状态
interface ThemeContextType {
  mode: ThemeMode;
  theme: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
  isDark: boolean;
}

export const ThemeContext = createContext<ThemeContextType | null>(null);

// 便捷 Hook：在子组件中使用主题
export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContext 必须在 ThemeContext.Provider 内使用');
  }
  return context;
}

const tabs: { id: TabType; label: string; Icon: typeof FolderSync }[] = [
  { id: 'migration', label: '应用管理', Icon: FolderSync },
  { id: 'folders', label: '数据迁移', Icon: FolderArchive },
  { id: 'history', label: '迁移历史', Icon: History },
  { id: 'settings', label: '设置', Icon: SettingsIcon },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('migration');
  const [disks, setDisks] = useState<DiskUsage[]>([]);
  const [diskLoading, setDiskLoading] = useState(true);
  const [diskRefreshing, setDiskRefreshing] = useState(false);

  // 初始化主题系统
  const themeState = useTheme();

  async function fetchDiskUsage() {
    try {
      setDiskLoading(true);
      const diskList = await invoke<DiskUsage[]>('get_disk_usage');
      setDisks(diskList);
    } catch (error) {
      console.error('获取全局磁盘信息失败:', error);
      setDisks([]);
    } finally {
      setDiskLoading(false);
    }
  }

  async function handleRefreshDiskUsage() {
    setDiskRefreshing(true);
    await fetchDiskUsage();
    setDiskRefreshing(false);
  }

  useEffect(() => {
    fetchDiskUsage();
  }, []);

  function renderContent() {
    switch (activeTab) {
      case 'migration':
        return <AppMigration />;
      case 'folders':
        return <LargeFolders />;
      case 'history':
        return <MigrationHistory />;
      case 'settings':
        return <Settings />;
      default:
        return <AppMigration />;
    }
  }

  return (
    <ThemeContext.Provider value={themeState}>
      <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg-app)' }}>

        {/* 统一标题栏：Logo + Tab 导航 + 磁盘状态 + 窗口控制 */}
        <TitleBar
          centerContent={(
            <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--bg-hover)' }}>
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                const Icon = tab.Icon;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className="relative flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-medium transition-all duration-200"
                    style={{
                      color: isActive ? 'var(--color-primary)' : 'var(--text-secondary)',
                      background: isActive ? 'var(--bg-card)' : 'transparent',
                      boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                    }}
                  >
                    {/* 激活态左侧小圆点 */}
                    {isActive && (
                      <span
                        className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full"
                        style={{ background: 'var(--color-primary)' }}
                      />
                    )}
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          rightContent={(
            <DiskUsageBar
              disks={disks}
              loading={diskLoading}
              refreshing={diskRefreshing}
              onRefresh={handleRefreshDiskUsage}
            />
          )}
        />

        {/* 页面内容区域 */}
        <main className="flex-1 overflow-hidden" style={{ background: 'var(--bg-card)' }}>
          <PageTransition pageKey={activeTab} className="h-full">
            {renderContent()}
          </PageTransition>
        </main>
      </div>
    </ThemeContext.Provider>
  );
}

export default App;
