// OrbitFile - 主应用组件
// 企业级模块化设计
// 集成主题系统，支持浅色/深色/跟随系统三种模式

import { useState, createContext, useContext } from 'react';
import TitleBar from './components/TitleBar';
import TabBar from './components/TabBar';
import AppMigration from './pages/AppMigration';
import LargeFolders from './pages/LargeFolders';
import MigrationHistory from './pages/MigrationHistory';
import Settings from './pages/Settings';
import { TabType } from './types';
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
  
  // 初始化主题系统
  const themeState = useTheme();

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
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* 页面内容区域 */}
        <main className="flex-1 overflow-hidden" style={{ background: 'var(--bg-card)' }}>
          {renderContent()}
        </main>
      </div>
    </ThemeContext.Provider>
  );
}

export default App;
