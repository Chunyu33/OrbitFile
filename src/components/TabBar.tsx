// Tab 导航栏组件
// Windows 11 风格的现代化设计

import { useState } from 'react';
import { FolderSync, FolderArchive, History, Settings } from 'lucide-react';
import { TabType } from '../types';

interface TabBarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

// Tab 配置
const tabs: { id: TabType; label: string; Icon: typeof FolderSync }[] = [
  { id: 'migration', label: '应用迁移', Icon: FolderSync },
  { id: 'folders', label: '大文件目录', Icon: FolderArchive },
  { id: 'history', label: '迁移历史', Icon: History },
  { id: 'settings', label: '设置', Icon: Settings },
];

export default function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const [hoveredTab, setHoveredTab] = useState<TabType | null>(null);

  return (
    <nav 
      style={{ 
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '8px 16px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const isHovered = hoveredTab === tab.id;
        const Icon = tab.Icon;
        
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            onMouseEnter={() => setHoveredTab(tab.id)}
            onMouseLeave={() => setHoveredTab(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--color-primary)' : isHovered ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isActive 
                ? 'var(--color-primary-light)' 
                : isHovered 
                  ? 'var(--color-gray-100)' 
                  : 'transparent',
              transition: 'all 0.15s ease',
              position: 'relative',
            }}
          >
            <Icon 
              style={{ 
                width: '16px', 
                height: '16px',
                opacity: isActive ? 1 : 0.8,
              }} 
            />
            <span>{tab.label}</span>
            
            {/* 激活指示器 - 左侧竖条 */}
            {isActive && (
              <span 
                style={{
                  position: 'absolute',
                  left: '0',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '3px',
                  height: '16px',
                  background: 'var(--color-primary)',
                  borderRadius: '0 2px 2px 0',
                }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
