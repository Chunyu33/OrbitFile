import type { ReactNode } from 'react';
import { FolderArchive, FolderSync, History, Settings } from 'lucide-react';
import type { TabType } from '../types';

interface ModernTabBarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  rightSlot?: ReactNode;
}

const tabs: { id: TabType; label: string; Icon: typeof FolderSync }[] = [
  { id: 'migration', label: '应用管理', Icon: FolderSync },
  { id: 'folders', label: '数据迁移', Icon: FolderArchive },
  { id: 'history', label: '迁移历史', Icon: History },
  { id: 'settings', label: '设置', Icon: Settings },
];

export default function ModernTabBar({ activeTab, onTabChange, rightSlot }: ModernTabBarProps) {
  return (
    <nav className="relative z-40 flex items-center justify-between h-12 px-4 bg-[var(--bg-card)]/82 backdrop-blur-md shadow-[0_1px_0_rgba(15,23,42,0.06)] dark:shadow-[0_1px_0_rgba(0,0,0,0.4)]">
      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--bg-hover)]/50">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.Icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`
                relative flex items-center gap-1.5 h-8 pl-5 pr-3 rounded-lg text-[13px] font-medium
                transition-all duration-200
                ${isActive 
                  ? 'text-[var(--color-primary)] bg-[var(--bg-card)]/75' 
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]/60'
                }
              `}
            >
              {isActive && (
                <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-[var(--color-primary)]" />
              )}
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {rightSlot && <div className="relative z-50 flex items-center">{rightSlot}</div>}
    </nav>
  );
}
