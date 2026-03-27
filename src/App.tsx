// OrbitFile - 主应用组件
// 企业级模块化设计
// 集成主题系统，支持浅色/深色/跟随系统三种模式

import { useEffect, useState, createContext, useContext } from 'react';
import { invoke } from '@tauri-apps/api/core';
import TitleBar from './components/TitleBar';
import TabBar from './components/TabBar';
import DiskUsageBar from './components/DiskUsageBar';
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
        {/* 自定义标题栏 */}
        <TitleBar />

        {/* Tab 导航栏 */}
        <TabBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          rightSlot={(
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
          {renderContent()}
        </main>
      </div>
    </ThemeContext.Provider>
  );
}

export default App;
