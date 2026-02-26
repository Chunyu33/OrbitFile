// Tab 导航栏组件
// 企业级模块化设计

import { FolderSync, History, Settings } from 'lucide-react';
import { TabType } from '../types';

interface TabBarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

// Tab 配置
const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'migration', label: '应用迁移', icon: <FolderSync className="w-4 h-4" /> },
  { id: 'history', label: '迁移历史', icon: <History className="w-4 h-4" /> },
  { id: 'settings', label: '设置', icon: <Settings className="w-4 h-4" /> },
];

export default function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <nav 
      className="flex items-center gap-3 px-6 h-12 border-b"
      style={{ 
        background: 'var(--bg-card)',
        borderColor: 'var(--border-color)'
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="relative flex items-center gap-2 px-4 h-9 text-sm font-medium rounded-md transition-all"
            style={{
              color: isActive ? 'var(--color-primary)' : 'var(--text-secondary)',
              background: isActive ? 'var(--color-primary-light)' : 'transparent',
              padding: '0 12px',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }
            }}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {/* 激活指示器 */}
            {isActive && (
              <span 
                className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-t-full"
                style={{ background: 'var(--color-primary)' }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
