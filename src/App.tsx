// OrbitFile - 主应用组件
// 企业级模块化设计

import { useState } from 'react';
import TitleBar from './components/TitleBar';
import TabBar from './components/TabBar';
import AppMigration from './pages/AppMigration';
import MigrationHistory from './pages/MigrationHistory';
import Settings from './pages/Settings';
import { TabType } from './types';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('migration');

  function renderContent() {
    switch (activeTab) {
      case 'migration':
        return <AppMigration />;
      case 'history':
        return <MigrationHistory />;
      case 'settings':
        return <Settings />;
      default:
        return <AppMigration />;
    }
  }

  return (
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
  );
}

export default App;
