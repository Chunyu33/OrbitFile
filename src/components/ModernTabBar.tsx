import { motion } from 'framer-motion';
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
    <nav className="flex items-center justify-between h-12 px-4 bg-[var(--bg-card)]/82 backdrop-blur-md shadow-[0_1px_0_rgba(15,23,42,0.06)] dark:shadow-[0_1px_0_rgba(0,0,0,0.4)]">
      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--bg-hover)]/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.Icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`
                relative flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium
                transition-all duration-200
                ${isActive 
                  ? 'text-[var(--color-primary)] bg-[var(--bg-card)] shadow-sm' 
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]/70'
                }
              `}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {isActive && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute -bottom-1 left-2 right-2 h-0.5 rounded-full bg-[var(--color-primary)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {rightSlot && <div className="flex items-center">{rightSlot}</div>}
    </nav>
  );
}
