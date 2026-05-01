// 设置页面
// 企业级模块化设计
// 包含外观设置（主题切换）、迁移设置、存储维护等功能

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import AppIconSvg from '../assets/icon.svg';
import {
  FolderCog, ChevronRight, User, Mail, Info,
  AlertTriangle, Lightbulb, FolderArchive, Trash2,
  AppWindow, Loader2, Sparkles, Sun, Moon, Monitor, Database
} from 'lucide-react';
import { useThemeContext } from '../App';
import type { ThemeMode } from '../hooks/useTheme';
import Toast, { useToast } from '../components/Toast';
import type { DataDirConfig, GhostLinkPreview } from '../types';

// 迁移统计信息接口
interface MigrationStats {
  total_space_saved: number;
  active_migrations: number;
  restored_count: number;
  app_migrations: number;
  folder_migrations: number;
}

// 清理结果接口
interface CleanupResult {
  cleaned_count: number;
  cleaned_size: number;
  errors: string[];
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// 应用配置信息（版本号将动态获取）
const APP_INFO = {
  name: 'OrbitFile',
  description: '专业的 Windows 应用管理、存储重定向工具',
  author: 'Evan Lau',
  email: 'liucygm33@gmail.com',
};

// 关于信息列表（动态数据格式，方便后续扩展）
const ABOUT_ITEMS = [
  { label: '作者', value: APP_INFO.author, icon: User },
  { label: '联系邮箱', value: APP_INFO.email, icon: Mail },
];

// 设置存储键名
const SETTINGS_KEY = 'orbitfile_settings';

// 默认设置
const DEFAULT_SETTINGS = {
  defaultTargetPath: 'D:\\Apps',
  useRecycleBin: true,
};

// 加载设置
function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('加载设置失败:', e);
  }
  return DEFAULT_SETTINGS;
}

// 保存设置
function saveSettings(settings: typeof DEFAULT_SETTINGS) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('保存设置失败:', e);
  }
}

// 开关组件
function Toggle({ active, onChange }: { active: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="relative flex-shrink-0 rounded-full border-none cursor-pointer transition-colors duration-150"
      style={{
        width: '40px',
        height: '22px',
        background: active ? 'var(--color-primary)' : 'var(--color-gray-300)',
      }}
    >
      <span
        className="absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full shadow-sm transition-all duration-150"
        style={{ left: active ? '20px' : '2px' }}
      />
    </button>
  );
}

// 主题切换按钮组件
function ThemeButton({ 
  mode, 
  currentMode, 
  onClick, 
  icon, 
  label 
}: { 
  mode: ThemeMode; 
  currentMode: ThemeMode; 
  onClick: () => void; 
  icon: React.ReactNode; 
  label: string;
}) {
  const isActive = mode === currentMode;
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center justify-center w-9 h-7 rounded-md border-none cursor-pointer transition-all duration-150 ${isActive ? 'bg-[var(--bg-card)] text-[var(--color-primary)] shadow-sm' : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
    >
      {icon}
    </button>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<MigrationStats | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<CleanupResult | null>(null);
  const [ghostPreview, setGhostPreview] = useState<GhostLinkPreview | null>(null);
  const [ghostScanning, setGhostScanning] = useState(false);
  const [appVersion, setAppVersion] = useState('...');
  // 数据目录状态
  const [dataDir, setDataDir] = useState('');
  const [dataDirLoading, setDataDirLoading] = useState(false);
  const currentYear = new Date().getFullYear();

  const { toast, showToast, hideToast } = useToast();

  // 获取主题状态
  const themeState = useThemeContext();

  // 加载设置、统计信息、版本号和数据目录
  useEffect(() => {
    setSettings(loadSettings());
    loadStats();
    loadDataDir();
    getVersion().then(setAppVersion).catch(() => setAppVersion('1.0.0'));
  }, []);

  // 加载迁移统计信息
  async function loadStats() {
    try {
      const result = await invoke<MigrationStats>('get_migration_stats');
      setStats(result);
    } catch (e) {
      console.error('加载统计信息失败:', e);
    }
  }

  // 加载当前数据目录
  async function loadDataDir() {
    try {
      const info = await invoke<DataDirConfig>('get_data_dir_info');
      setDataDir(info.data_dir);
    } catch (e) {
      console.error('加载数据目录失败:', e);
    }
  }

  // 修改数据目录
  async function handleChangeDataDir() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择新的数据存储目录',
    });
    if (!selected || typeof selected !== 'string') return;

    // 确认迁移
    const confirmed = await confirm(
      `数据目录将从:\n${dataDir}\n\n迁移到:\n${selected}\n\n所有迁移历史、自定义文件夹等数据将自动复制到新位置。\n原位置的文件将保留作为备份。\n\n是否继续？`,
      {
        title: '确认迁移数据目录',
        kind: 'warning',
        okLabel: '确认迁移',
        cancelLabel: '取消',
      }
    );
    if (!confirmed) return;

    setDataDirLoading(true);
    try {
      await invoke('set_data_dir', { newPath: selected });
      setDataDir(selected);
      showToast('数据目录已成功迁移', 'success');
    } catch (e) {
      console.error('迁移数据目录失败:', e);
      showToast(`迁移失败: ${e}`, 'error');
    } finally {
      setDataDirLoading(false);
    }
  }

  // 在文件资源管理器中打开数据目录
  async function handleOpenDataDir() {
    try {
      await invoke('open_data_dir');
    } catch (e) {
      showToast(`打开失败: ${e}`, 'error');
    }
  }

  // 预览幽灵链接（第一步：只读扫描）
  async function handlePreviewGhostLinks() {
    try {
      setGhostScanning(true);
      setGhostPreview(null);
      setCleanResult(null);
      const preview = await invoke<GhostLinkPreview>('preview_ghost_links');
      setGhostPreview(preview);
    } catch (e) {
      console.error('预览失败:', e);
    } finally {
      setGhostScanning(false);
    }
  }

  // 执行清理幽灵链接（第二步：确认后执行）
  async function handleCleanGhostLinks() {
    try {
      setCleaning(true);
      setCleanResult(null);
      const result = await invoke<CleanupResult>('clean_ghost_links');
      setCleanResult(result);
      setGhostPreview(null);
      await loadStats();
    } catch (e) {
      console.error('清理失败:', e);
    } finally {
      setCleaning(false);
    }
  }

  // 更新设置
  const updateSetting = <K extends keyof typeof DEFAULT_SETTINGS>(
    key: K,
    value: typeof DEFAULT_SETTINGS[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  // 选择默认迁移目标文件夹
  const handleSelectTargetPath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择默认迁移目标文件夹',
      });
      if (selected && typeof selected === 'string') {
        updateSetting('defaultTargetPath', selected);
      }
    } catch (e) {
      console.error('选择文件夹失败:', e);
    }
  };

  return (
    <div className="h-full overflow-auto px-5 py-5">
      <div className="max-w-3xl mx-auto flex flex-col gap-5">

        {/* 已节省空间统计卡片 */}
        {stats && stats.active_migrations > 0 && (
          <section
            className="rounded-lg overflow-hidden text-white"
            style={{ 
              padding: 'var(--spacing-5)',
              background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-active) 100%)',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center" style={{ gap: '8px', marginBottom: '8px' }}>
                  <Sparkles className="w-5 h-5" />
                  <span style={{ fontSize: '14px', opacity: 0.9 }}>已节省空间</span>
                </div>
                <div style={{ fontSize: '32px', fontWeight: 700, marginBottom: '4px' }}>
                  {formatSize(stats.total_space_saved)}
                </div>
                <div style={{ fontSize: '12px', opacity: 0.8 }}>
                  通过 {stats.active_migrations} 次迁移释放
                </div>
              </div>
              <div style={{ display: 'flex', gap: '16px' }}>
                {stats.app_migrations > 0 && (
                  <div style={{ textAlign: 'center' }}>
                    <div className="flex items-center justify-center" style={{ 
                      width: '40px', height: '40px', 
                      background: 'rgba(255,255,255,0.2)', 
                      borderRadius: '8px',
                      marginBottom: '4px',
                    }}>
                      <AppWindow className="w-5 h-5" />
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{stats.app_migrations}</div>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>应用</div>
                  </div>
                )}
                {stats.folder_migrations > 0 && (
                  <div style={{ textAlign: 'center' }}>
                    <div className="flex items-center justify-center" style={{ 
                      width: '40px', height: '40px', 
                      background: 'rgba(255,255,255,0.2)', 
                      borderRadius: '8px',
                      marginBottom: '4px',
                    }}>
                      <FolderArchive className="w-5 h-5" />
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{stats.folder_migrations}</div>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>文件夹</div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 外观设置 - 主题切换 */}
        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
          <div 
            style={{ 
              padding: 'var(--spacing-3) var(--spacing-5)',
              background: 'var(--color-gray-50)',
              borderBottom: '1px solid var(--border-color)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            外观设置
          </div>
          
          {/* 主题切换 */}
          <div className="setting-item" style={{ padding: 'var(--spacing-4) var(--spacing-5)', margin: 0 }}>
            <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
              <div 
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--color-primary-light)' }}
              >
                {themeState.isDark ? (
                  <Moon className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
                ) : (
                  <Sun className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
                )}
              </div>
              <div>
                <p className="setting-label">主题模式</p>
                <p className="setting-desc">选择浅色、深色或跟随系统</p>
              </div>
            </div>
            
            {/* 分段控制器 - 三个图标按钮 */}
            <div 
              className="flex items-center"
              style={{ 
                background: 'var(--color-gray-100)',
                borderRadius: 'var(--radius-lg)',
                padding: '3px',
                gap: '2px',
              }}
            >
              <ThemeButton 
                mode="light" 
                currentMode={themeState.mode} 
                onClick={() => themeState.setTheme('light')}
                icon={<Sun className="w-4 h-4" />}
                label="浅色"
              />
              <ThemeButton 
                mode="dark" 
                currentMode={themeState.mode} 
                onClick={() => themeState.setTheme('dark')}
                icon={<Moon className="w-4 h-4" />}
                label="深色"
              />
              <ThemeButton 
                mode="system" 
                currentMode={themeState.mode} 
                onClick={() => themeState.setTheme('system')}
                icon={<Monitor className="w-4 h-4" />}
                label="系统"
              />
            </div>
          </div>
        </section>

        {/* 迁移设置 */}
        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
          <div 
            style={{ 
              padding: 'var(--spacing-3) var(--spacing-5)',
              background: 'var(--color-gray-50)',
              borderBottom: '1px solid var(--border-color)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            迁移设置
          </div>
          
          {/* 默认目标路径 */}
          <button 
            onClick={handleSelectTargetPath}
            className="setting-item" 
            style={{ 
              padding: 'var(--spacing-4) var(--spacing-5)', 
              margin: 0, 
              borderBottom: '1px solid var(--border-color)',
              background: 'transparent',
              border: 'none',
              borderBottomWidth: '1px',
              borderBottomStyle: 'solid',
              borderBottomColor: 'var(--border-color)',
              width: '100%',
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
              <div 
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--color-primary-light)' }}
              >
                <FolderCog className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
              </div>
              <div>
                <p className="setting-label">默认迁移目标</p>
                <p className="setting-desc">选择应用迁移的默认目标文件夹</p>
              </div>
            </div>
            <div className="flex items-center" style={{ gap: 'var(--spacing-2)' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)' }}>{settings.defaultTargetPath}</span>
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </div>
          </button>

          {/* 删除方式 */}
          <div className="setting-item" style={{ padding: 'var(--spacing-4) var(--spacing-5)', margin: 0, borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--color-info-light)' }}
              >
                <Trash2 className="w-4 h-4" style={{ color: 'var(--color-info)' }} />
              </div>
              <div>
                <p className="setting-label">删除文件移入回收站</p>
                <p className="setting-desc">关闭后直接彻底删除（不可逆）</p>
              </div>
            </div>
            <Toggle active={settings.useRecycleBin} onChange={() => updateSetting('useRecycleBin', !settings.useRecycleBin)} />
          </div>
        </section>

        {/* 数据存储目录 */}
        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
          <div
            style={{
              padding: 'var(--spacing-3) var(--spacing-5)',
              background: 'var(--color-gray-50)',
              borderBottom: '1px solid var(--border-color)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            数据管理
          </div>

          {/* 数据目录位置 */}
          <div className="setting-item" style={{ padding: 'var(--spacing-4) var(--spacing-5)', margin: 0 }}>
            <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-primary-light)' }}
              >
                <Database className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="setting-label">数据存储目录</p>
                <p className="setting-desc" title={dataDir}>
                  迁移历史、自定义文件夹、模板配置等数据的存放位置
                </p>
                {dataDir && (
                  <p
                    className="text-[11px] mt-1 truncate"
                    style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}
                    title={dataDir}
                  >
                    {dataDir}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleChangeDataDir}
                disabled={dataDirLoading}
                className="h-8 px-3 text-[12px] font-medium rounded-md border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {dataDirLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    迁移中
                  </>
                ) : (
                  <>
                    <FolderCog className="w-3.5 h-3.5" />
                    更改
                  </>
                )}
              </button>
              <button
                onClick={handleOpenDataDir}
                className="h-8 px-3 text-[12px] font-medium rounded-md border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors inline-flex items-center gap-1.5"
                title="在文件资源管理器中打开数据目录"
              >
                <FolderArchive className="w-3.5 h-3.5" />
                前往
              </button>
            </div>
          </div>
        </section>

        {/* 存储维护 */}
        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
          <div 
            style={{ 
              padding: 'var(--spacing-3) var(--spacing-5)',
              background: 'var(--color-gray-50)',
              borderBottom: '1px solid var(--border-color)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            存储维护
          </div>
          
          {/* 清理无效记录 */}
          <div style={{ padding: 'var(--spacing-4) var(--spacing-5)' }}>
            <div className="flex items-start" style={{ gap: 'var(--spacing-3)' }}>
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-danger-light)' }}
              >
                <Trash2 className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <p className="setting-label">清理无效记录</p>
                <p className="setting-desc" style={{ marginBottom: 'var(--spacing-3)' }}>
                  扫描并清理"幽灵链接"——目标磁盘已移除或文件已删除的迁移记录。
                  先预览确认，再执行清理。
                </p>

                {/* 第一步：扫描预览 */}
                {!ghostPreview ? (
                  <button
                    onClick={handlePreviewGhostLinks}
                    disabled={ghostScanning}
                    className="btn btn-secondary"
                    style={{ marginBottom: cleanResult ? 'var(--spacing-3)' : 0 }}
                  >
                    {ghostScanning ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        扫描中...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        扫描幽灵链接
                      </>
                    )}
                  </button>
                ) : (
                  <div style={{ marginBottom: 'var(--spacing-3)' }}>
                    {ghostPreview.entries.length > 0 ? (
                      <>
                        <div className="rounded-lg border p-3 mb-3" style={{
                          borderColor: 'var(--color-warning)',
                          background: 'var(--color-warning-light)',
                          maxHeight: '240px',
                          overflowY: 'auto',
                        }}>
                          <p className="text-[12px] font-medium mb-2" style={{ color: 'var(--color-warning)' }}>
                            发现 {ghostPreview.entries.length} 条幽灵链接（总计 {formatSize(ghostPreview.total_size)}）
                          </p>
                          {ghostPreview.entries.map(e => (
                            <div key={e.record_id} className="text-[11px] py-1" style={{ color: 'var(--text-secondary)' }}>
                              <span className="font-medium">{e.app_name}</span>
                              <span className="text-[var(--text-tertiary)]"> · 原路径: {e.original_path}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleCleanGhostLinks}
                            disabled={cleaning}
                            className="btn btn-sm"
                            style={{
                              background: 'var(--color-danger)',
                              color: 'var(--text-inverse)',
                              borderColor: 'var(--color-danger)',
                            }}
                          >
                            {cleaning ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                清理中...
                              </>
                            ) : (
                              <>
                                <Trash2 className="w-3.5 h-3.5" />
                                确认清理
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => setGhostPreview(null)}
                            disabled={cleaning}
                            className="btn btn-ghost btn-sm"
                          >
                            取消
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                        未发现幽灵链接，所有记录状态正常
                      </div>
                    )}
                  </div>
                )}

                {/* 清理结果 */}
                {cleanResult && (
                  <div
                    style={{
                      padding: 'var(--spacing-3)',
                      background: cleanResult.cleaned_count > 0 ? 'var(--color-success-light)' : 'var(--color-gray-50)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--font-size-xs)',
                    }}
                  >
                    {cleanResult.cleaned_count > 0 ? (
                      <div style={{ color: 'var(--color-success)' }}>
                        ✓ 已清理 {cleanResult.cleaned_count} 条无效记录，释放 {formatSize(cleanResult.cleaned_size)} 记录空间
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-tertiary)' }}>
                        ✓ 未发现无效记录，所有链接状态正常
                      </div>
                    )}
                    {cleanResult.errors.length > 0 && (
                      <div style={{ color: 'var(--color-danger)', marginTop: 'var(--spacing-2)' }}>
                        {cleanResult.errors.map((err, i) => (
                          <div key={i}>⚠ {err}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 导出历史记录 */}
            <div className="flex items-start mt-4" style={{ gap: 'var(--spacing-3)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-4)' }}>
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--bg-hover)' }}
              >
                <Database className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <p className="setting-label">导入/导出历史记录</p>
                <p className="setting-desc" style={{ marginBottom: 'var(--spacing-2)' }}>
                  导出备份到指定目录，或从备份文件导入合并（按 ID 去重）。
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const selected = await open({
                          directory: true,
                          multiple: false,
                          title: '选择导出目录',
                        });
                        if (!selected || typeof selected !== 'string') return;
                        const destPath = `${selected}\\migration_history.json`;
                        await invoke('export_history', { destPath });
                        showToast('历史记录已导出', 'success');
                      } catch (e) {
                        showToast(`导出失败: ${e}`, 'error');
                      }
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    <Database className="w-3.5 h-3.5" />
                    导出
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const selected = await open({
                          multiple: false,
                          title: '选择历史记录文件',
                          filters: [{ name: 'JSON', extensions: ['json'] }],
                        });
                        if (!selected || typeof selected !== 'string') return;
                        const added = await invoke<number>('import_history', { srcPath: selected });
                        showToast(`已导入 ${added} 条新记录`, 'success');
                        await loadStats();
                      } catch (e) {
                        showToast(`导入失败: ${e}`, 'error');
                      }
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    <Database className="w-3.5 h-3.5" />
                    导入
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 使用说明 */}
        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
          <div 
            style={{ 
              padding: 'var(--spacing-3) var(--spacing-5)',
              background: 'var(--color-gray-50)',
              borderBottom: '1px solid var(--border-color)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            使用说明
          </div>
          
          {/* 工作原理 */}
          <div style={{ padding: 'var(--spacing-4) var(--spacing-5)', borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-start" style={{ gap: 'var(--spacing-3)' }}>
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-primary-light)' }}
              >
                <Info className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
              </div>
              <div>
                <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)', marginBottom: 'var(--spacing-2)' }}>
                  迁移工作原理
                </p>
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', lineHeight: '1.6' }}>
                  OrbitFile 使用 Windows 符号链接（Symbolic Link）技术，将应用文件夹从 C 盘移动到其他磁盘，
                  并在原位置创建一个指向新位置的链接。系统和应用程序会透明地通过这个链接访问文件，
                  因此应用可以正常运行，同时释放了 C 盘空间。
                </p>
              </div>
            </div>
          </div>

          {/* 解决的问题 */}
          <div style={{ padding: 'var(--spacing-4) var(--spacing-5)', borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-start" style={{ gap: 'var(--spacing-3)' }}>
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-success-light)' }}
              >
                <Lightbulb className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
              </div>
              <div>
                <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)', marginBottom: 'var(--spacing-2)' }}>
                  解决的问题
                </p>
                <ul style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', lineHeight: '1.8', paddingLeft: 'var(--spacing-4)', margin: 0 }}>
                  <li>C 盘空间不足，系统运行缓慢</li>
                  <li>大型应用占用过多系统盘空间</li>
                  <li>手动移动应用文件夹会导致应用无法运行</li>
                  <li>无需重新安装即可迁移应用</li>
                </ul>
              </div>
            </div>
          </div>

          {/* 注意事项 */}
          <div style={{ padding: 'var(--spacing-4) var(--spacing-5)', borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-start" style={{ gap: 'var(--spacing-3)' }}>
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-warning-light)' }}
              >
                <AlertTriangle className="w-4 h-4" style={{ color: 'var(--color-warning)' }} />
              </div>
              <div>
                <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)', marginBottom: 'var(--spacing-2)' }}>
                  注意事项
                </p>
                <ul style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', lineHeight: '1.8', paddingLeft: 'var(--spacing-4)', margin: 0 }}>
                  <li>迁移前请关闭目标应用程序</li>
                  <li>需要管理员权限才能创建符号链接</li>
                  <li>不建议迁移系统核心组件和杀毒软件</li>
                  <li>目标磁盘必须是 NTFS 格式的本地磁盘</li>
                  <li>迁移后请勿删除目标位置的文件</li>
                </ul>
              </div>
            </div>
          </div>

          {/* 数据迁移说明 */}
          <div style={{ padding: 'var(--spacing-4) var(--spacing-5)' }}>
            <div className="flex items-start" style={{ gap: 'var(--spacing-3)' }}>
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-danger-light)' }}
              >
                <FolderArchive className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
              </div>
              <div>
                <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)', marginBottom: 'var(--spacing-2)' }}>
                  数据迁移说明
                </p>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', lineHeight: '1.8' }}>
                  <p style={{ marginBottom: 'var(--spacing-2)' }}>
                    <strong style={{ color: 'var(--color-danger)' }}>⚠️ 与系统自带"更改位置"功能的区别：</strong>
                  </p>
                  <ul style={{ paddingLeft: 'var(--spacing-4)', margin: '0 0 var(--spacing-3) 0' }}>
                    <li>
                      <strong style={{ color: 'var(--text-secondary)' }}>Windows 属性 → 位置 → 移动</strong>：
                      修改的是 Shell 文件夹的注册表指向，系统会将该文件夹视为新位置，<strong style={{ color: 'var(--color-primary)' }}>原路径将不再存在</strong>
                    </li>
                    <li>
                      <strong style={{ color: 'var(--text-secondary)' }}>OrbitFile 迁移</strong>：
                      使用 Junction（目录联接）技术，<strong style={{ color: 'var(--color-primary)' }}>原路径仍然可用</strong>，只是指向了新位置
                    </li>
                  </ul>
                  
                  <p style={{ marginBottom: 'var(--spacing-2)' }}>
                    <strong style={{ color: 'var(--color-warning)' }}>🔄 二次迁移兼容性：</strong>
                  </p>
                  <ul style={{ paddingLeft: 'var(--spacing-4)', margin: '0 0 var(--spacing-3) 0' }}>
                    <li>
                      如果您<strong style={{ color: 'var(--text-secondary)' }}>已使用系统自带功能更改过位置</strong>，
                      OrbitFile 会检测到新的实际路径并正常工作
                    </li>
                    <li>
                      <strong style={{ color: 'var(--color-danger)' }}>不建议</strong>对同一文件夹同时使用两种方式迁移
                    </li>
                  </ul>

                  <p style={{ marginBottom: 'var(--spacing-2)' }}>
                    <strong style={{ color: 'var(--color-danger)' }}>❗ 系统文件夹迁移风险：</strong>
                  </p>
                  <ul style={{ paddingLeft: 'var(--spacing-4)', margin: 0 }}>
                    <li>桌面、文档、下载等系统文件夹与 Windows Shell 深度集成</li>
                    <li>迁移后可能影响 OneDrive 同步、快速访问等功能</li>
                    <li>部分应用可能无法正确识别 Junction 链接</li>
                    <li><strong style={{ color: 'var(--color-success)' }}>建议</strong>：优先迁移微信、QQ、钉钉等应用数据，风险较低</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* 强力卸载说明 */}
          <div style={{ padding: 'var(--spacing-4) var(--spacing-5)', borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-start" style={{ gap: 'var(--spacing-3)' }}>
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-danger-light)' }}
              >
                <Trash2 className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
              </div>
              <div>
                <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)', marginBottom: 'var(--spacing-2)' }}>
                  强力卸载说明
                </p>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', lineHeight: '1.8' }}>
                  <p style={{ marginBottom: 'var(--spacing-2)' }}>
                    常规卸载器通常只移除主程序，应用日志、缓存仍可能残留在 <strong style={{ color: 'var(--text-secondary)' }}>AppData</strong>，
                    同时注册表中的卸载/配置项也可能保留。
                  </p>
                  <p style={{ marginBottom: 'var(--spacing-2)' }}>
                    OrbitFile 的强力卸载流程为：
                  </p>
                  <ol style={{ paddingLeft: 'var(--spacing-4)', margin: '0 0 var(--spacing-2) 0' }}>
                    <li>优先调用应用官方卸载器，并等待卸载进程完成（含必要的提权回退）。</li>
                    <li>由你手动确认后再触发残留扫描，避免卸载未落盘时误扫。</li>
                    <li>基于应用名、发布商、安装路径等指纹做“数字残留”匹配，定位文件与注册表痕迹。</li>
                    <li>仅对确认匹配的条目执行删除，默认不做激进清理。</li>
                  </ol>
                  <p style={{ margin: 0 }}>
                    为保证系统稳定性，清理阶段内置系统目录黑名单与注册表安全校验，
                    会拒绝删除 Windows/Microsoft 等高风险路径与关键分支。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 关于 */}
        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
          <div 
            style={{ 
              padding: 'var(--spacing-3) var(--spacing-5)',
              background: 'var(--color-gray-50)',
              borderBottom: '1px solid var(--border-color)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            关于
          </div>
          
          {/* 应用信息 */}
          <div className="setting-item" style={{ padding: 'var(--spacing-4) var(--spacing-5)', margin: 0, borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
              <div 
                className="w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden"
                style={{ background: 'var(--color-primary)' }}
              >
                <img src={AppIconSvg} alt="OrbitFile" className="w-9 h-9" />
              </div>
              <div>
                <p className="setting-label">{APP_INFO.name}</p>
                <p className="setting-desc">{APP_INFO.description}</p>
              </div>
            </div>
            <span className="badge badge-primary">v{appVersion}</span>
          </div>

          {/* 动态渲染关于信息列表 */}
          {ABOUT_ITEMS.map((item, index) => (
            <div 
              key={item.label}
              className="setting-item" 
              style={{ 
                padding: 'var(--spacing-4) var(--spacing-5)', 
                margin: 0, 
                borderBottom: index < ABOUT_ITEMS.length - 1 ? '1px solid var(--border-color)' : 'none'
              }}
            >
              <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
                <div 
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--color-gray-100)' }}
                >
                  <item.icon className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                </div>
                <span className="setting-label">{item.label}</span>
              </div>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)' }}>{item.value}</span>
            </div>
          ))}
        </section>

        {/* 版权声明 */}
        <div
          className="flex items-center justify-center"
          style={{
            padding: 'var(--spacing-4)',
            color: 'var(--text-muted)',
            fontSize: 'var(--font-size-xs)'
          }}
        >
          <span>© {currentYear} {APP_INFO.name}. All rights reserved.</span>
        </div>
      </div>

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
