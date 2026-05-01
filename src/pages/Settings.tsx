// 设置页面 — 桌面工具风格
// 克制配色，紧凑布局

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import AppIconSvg from '../assets/icon.svg';
import {
  FolderCog, ChevronRight, User, Mail,
  FolderArchive, Trash2,
  AppWindow, Loader2, Sun, Moon, Monitor, Database,
  Github, Video, ExternalLink, BookOpen,
} from 'lucide-react';
import { useThemeContext } from '../App';
import type { ThemeMode } from '../hooks/useTheme';
import Toast, { useToast } from '../components/Toast';
import UserManual from '../components/UserManual';
import type { DataDirConfig, GhostLinkPreview } from '../types';

interface MigrationStats {
  total_space_saved: number;
  active_migrations: number;
  restored_count: number;
  app_migrations: number;
  folder_migrations: number;
}

interface CleanupResult {
  cleaned_count: number;
  cleaned_size: number;
  errors: string[];
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const APP_INFO = {
  name: 'OrbitFile',
  description: 'Windows 应用管理与存储重定向工具',
  author: 'Evan Lau',
  email: 'liucygm33@gmail.com',
};

const ABOUT_ITEMS = [
  { label: '作者', value: APP_INFO.author, icon: User },
  { label: '联系邮箱', value: APP_INFO.email, icon: Mail },
];

const SETTINGS_KEY = 'orbitfile_settings';
const DEFAULT_SETTINGS = { defaultTargetPath: 'D:\\Apps', useRecycleBin: true };

function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}

function saveSettings(s: typeof DEFAULT_SETTINGS) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function Toggle({ active, onChange }: { active: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="relative flex-shrink-0 rounded-full cursor-pointer transition-colors"
      style={{ width: '36px', height: '20px', background: active ? 'var(--color-primary)' : 'var(--color-gray-300)' }}
    >
      <span className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all"
        style={{ left: active ? '18px' : '2px' }} />
    </button>
  );
}

function ThemeButton({ mode, currentMode, onClick, icon, label }: {
  mode: ThemeMode; currentMode: ThemeMode; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  const isActive = mode === currentMode;
  return (
    <button onClick={onClick} title={label}
      className={`flex items-center justify-center w-8 h-6 rounded border-none cursor-pointer transition-all ${
        isActive ? '' : 'opacity-50 hover:opacity-100'
      }`}
      style={{
        color: isActive ? 'var(--color-primary)' : 'var(--text-tertiary)',
        background: isActive ? 'var(--color-primary-light)' : 'transparent',
      }}>
      {icon}
    </button>
  );
}

// section header
function SectionHeader({ label }: { label: string }) {
  return (
    <div className="text-[10px] uppercase tracking-wider font-medium mb-2 px-1"
      style={{ color: 'var(--text-tertiary)' }}>{label}</div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<MigrationStats | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<CleanupResult | null>(null);
  const [ghostPreview, setGhostPreview] = useState<GhostLinkPreview | null>(null);
  const [ghostScanning, setGhostScanning] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [appVersion, setAppVersion] = useState('...');
  const [dataDir, setDataDir] = useState('');
  const [dataDirLoading, setDataDirLoading] = useState(false);
  const currentYear = new Date().getFullYear();

  const { toast, showToast, hideToast } = useToast();
  const themeState = useThemeContext();

  useEffect(() => {
    setSettings(loadSettings());
    loadStats();
    loadDataDir();
    getVersion().then(setAppVersion).catch(() => setAppVersion('1.0.0'));
  }, []);

  async function loadStats() {
    try { setStats(await invoke<MigrationStats>('get_migration_stats')); }
    catch { /* ignore */ }
  }
  async function loadDataDir() {
    try { const info = await invoke<DataDirConfig>('get_data_dir_info'); setDataDir(info.data_dir); }
    catch { /* ignore */ }
  }

  async function handleChangeDataDir() {
    const selected = await open({ directory: true, multiple: false, title: '选择新的数据存储目录' });
    if (!selected || typeof selected !== 'string') return;
    const confirmed = await confirm(
      `数据目录将从:\n${dataDir}\n\n迁移到:\n${selected}\n\n所有数据将自动复制到新位置。`,
      { title: '确认迁移数据目录', kind: 'warning', okLabel: '确认迁移', cancelLabel: '取消' }
    );
    if (!confirmed) return;
    setDataDirLoading(true);
    try {
      await invoke('set_data_dir', { newPath: selected });
      setDataDir(selected);
      showToast('数据目录已成功迁移', 'success');
    } catch (e) { showToast(`迁移失败: ${e}`, 'error'); }
    finally { setDataDirLoading(false); }
  }

  async function handleOpenDataDir() {
    try { await invoke('open_data_dir'); }
    catch (e) { showToast(`打开失败: ${e}`, 'error'); }
  }

  async function handlePreviewGhostLinks() {
    try {
      setGhostScanning(true); setGhostPreview(null); setCleanResult(null);
      const result = await invoke<GhostLinkPreview>('preview_ghost_links');
      setGhostPreview(result);
      if (result.entries.length === 0) {
        showToast('未发现无效记录', 'info');
      }
    } catch { /* ignore */ }
    finally { setGhostScanning(false); }
  }

  async function handleCleanGhostLinks() {
    try {
      setCleaning(true); setCleanResult(null);
      const result = await invoke<CleanupResult>('clean_ghost_links');
      setCleanResult(result); setGhostPreview(null);
      await loadStats();
    } catch { /* ignore */ }
    finally { setCleaning(false); }
  }

  const updateSetting = <K extends keyof typeof DEFAULT_SETTINGS>(k: K, v: typeof DEFAULT_SETTINGS[K]) => {
    const ns = { ...settings, [k]: v }; setSettings(ns); saveSettings(ns);
  };

  const handleSelectTargetPath = async () => {
    const selected = await open({ directory: true, multiple: false, title: '选择默认迁移目标文件夹' });
    if (selected && typeof selected === 'string') updateSetting('defaultTargetPath', selected);
  };

  return (
    <div className="h-full overflow-auto" style={{ padding: '16px 20px' }}>
      <div className="flex flex-col gap-4" style={{ maxWidth: '640px', margin: '0 auto' }}>

        {/* stats summary — 绿色强调分隔线 + 柔和背景 */}
        {stats && stats.active_migrations > 0 && (
          <div className="relative rounded-lg overflow-hidden" style={{ background: 'var(--color-primary-light)' }}>
            {/* 左侧强调线 */}
            <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: 'var(--color-primary)' }} />
            <div className="flex items-center gap-6 py-4 px-5 text-[12px]">
              <div className="flex items-baseline gap-1.5">
                <span style={{ color: 'var(--text-secondary)' }}>已节省</span>
                <strong style={{ color: 'var(--color-primary)', fontSize: '22px', fontWeight: 600, lineHeight: 1 }}>
                  {formatSize(stats.total_space_saved)}
                </strong>
              </div>
              <div className="flex items-center gap-4 ml-auto">
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {stats.active_migrations} 次迁移
                </span>
                {stats.app_migrations > 0 && (
                  <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                    <AppWindow className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} />
                    {stats.app_migrations} 应用
                  </span>
                )}
                {stats.folder_migrations > 0 && (
                  <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                    <FolderArchive className="w-3.5 h-3.5" style={{ color: 'var(--color-warning)' }} />
                    {stats.folder_migrations} 文件夹
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* appearance */}
        <section>
          <SectionHeader label="外观" />
          <div className="rounded border" style={{ borderColor: 'var(--border-color)' }}>
            <div className="setting-item" style={{ padding: '10px 14px' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: 'var(--bg-row-hover)' }}>
                  {themeState.isDark ? <Moon className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
                    : <Sun className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />}
                </div>
                <div>
                  <p className="setting-label">主题模式</p>
                  <p className="setting-desc">浅色、深色或跟随系统</p>
                </div>
              </div>
              <div className="flex items-center rounded p-0.5 gap-0.5" style={{ background: 'var(--bg-row-hover)' }}>
                <ThemeButton mode="light" currentMode={themeState.mode} onClick={() => themeState.setTheme('light')}
                  icon={<Sun className="w-4 h-4" />} label="浅色" />
                <ThemeButton mode="dark" currentMode={themeState.mode} onClick={() => themeState.setTheme('dark')}
                  icon={<Moon className="w-4 h-4" />} label="深色" />
                <ThemeButton mode="system" currentMode={themeState.mode} onClick={() => themeState.setTheme('system')}
                  icon={<Monitor className="w-4 h-4" />} label="系统" />
              </div>
            </div>
          </div>
        </section>

        {/* migration settings */}
        <section>
          <SectionHeader label="迁移设置" />
          <div className="rounded border" style={{ borderColor: 'var(--border-color)' }}>
            <button onClick={handleSelectTargetPath}
              className="setting-item w-full text-left"
              style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: 'var(--bg-row-hover)' }}>
                  <FolderCog className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
                </div>
                <div>
                  <p className="setting-label">默认迁移目标</p>
                  <p className="setting-desc">选择应用迁移的默认目标文件夹</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{settings.defaultTargetPath}</span>
                <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
              </div>
            </button>
            <div className="setting-item" style={{ padding: '10px 14px' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: 'var(--bg-row-hover)' }}>
                  <Trash2 className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                </div>
                <div>
                  <p className="setting-label">删除文件移入回收站</p>
                  <p className="setting-desc">关闭后直接彻底删除</p>
                </div>
              </div>
              <Toggle active={settings.useRecycleBin} onChange={() => updateSetting('useRecycleBin', !settings.useRecycleBin)} />
            </div>
          </div>
        </section>

        {/* data management */}
        <section>
          <SectionHeader label="数据管理" />
          <div className="rounded border" style={{ borderColor: 'var(--border-color)' }}>
            <div className="setting-item" style={{ padding: '10px 14px' }}>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'var(--bg-row-hover)' }}>
                  <Database className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="setting-label">数据存储目录</p>
                  {dataDir && <p className="text-[11px] truncate font-mono" style={{ color: 'var(--text-tertiary)' }} title={dataDir}>{dataDir}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={handleChangeDataDir} disabled={dataDirLoading} className="btn h-7 text-[11px]">
                  {dataDirLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderCog className="w-3 h-3" />}
                  {dataDirLoading ? '迁移中' : '更改'}
                </button>
                <button onClick={handleOpenDataDir} className="btn h-7 text-[11px]">
                  <FolderArchive className="w-3 h-3" />
                  前往
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* maintenance */}
        <section>
          <SectionHeader label="存储维护" />
          <div className="rounded border" style={{ borderColor: 'var(--border-color)', padding: '12px 14px' }}>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-danger-light)' }}>
                <Trash2 className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="setting-label mb-1">清理无效记录</p>
                <p className="setting-desc" style={{ marginBottom: '20px' }}>
                  扫描并清理目标磁盘已移除的幽灵链接。先预览，再确认清理。
                </p>

                <button onClick={handlePreviewGhostLinks} disabled={ghostScanning} className="btn h-7 text-[12px]">
                  {ghostScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  {ghostScanning ? '扫描中...' : '扫描幽灵链接'}
                </button>

                {ghostPreview && ghostPreview.entries.length > 0 && (
                  <div className="mt-3">
                    <div className="rounded border p-3 mb-3 text-[11px]" style={{ borderColor: 'var(--border-color-strong)', maxHeight: '200px', overflowY: 'auto' }}>
                      <p className="font-medium mb-2" style={{ color: 'var(--color-warning)' }}>
                        发现 {ghostPreview.entries.length} 条幽灵链接（{formatSize(ghostPreview.total_size)}）
                      </p>
                      {ghostPreview.entries.map(e => (
                        <div key={e.record_id} className="py-0.5">
                          <span style={{ color: 'var(--text-primary)' }}>{e.app_name}</span>
                          <span style={{ color: 'var(--text-tertiary)' }}> — {e.original_path}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={handleCleanGhostLinks} disabled={cleaning} className="btn btn-danger h-7 text-[11px]">
                        {cleaning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        {cleaning ? '清理中...' : '确认清理'}
                      </button>
                      <button onClick={() => setGhostPreview(null)} disabled={cleaning} className="btn btn-ghost h-7 text-[11px]">取消</button>
                    </div>
                  </div>
                )}

                {cleanResult && (
                  <div className="rounded p-2 text-[11px]" style={{
                    background: cleanResult.cleaned_count > 0 ? 'var(--color-success-light)' : 'var(--bg-row-hover)',
                    color: cleanResult.cleaned_count > 0 ? 'var(--color-success)' : 'var(--text-tertiary)',
                  }}>
                    {cleanResult.cleaned_count > 0
                      ? `已清理 ${cleanResult.cleaned_count} 条记录（${formatSize(cleanResult.cleaned_size)}）
`
                      : '未发现无效记录'}
                    {cleanResult.errors.length > 0 && (
                      <div style={{ color: 'var(--color-danger)', marginTop: '4px' }}>
                        {cleanResult.errors.map((err, i) => <div key={i}>{err}</div>)}
                      </div>
                    )}
                  </div>
                )}

                {/* export/import */}
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
                  <p className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)' }}>导入/导出历史记录</p>
                  <div className="flex items-center gap-2">
                    <button onClick={async () => {
                      try {
                        const sel = await open({ directory: true, multiple: false, title: '选择导出目录' });
                        if (!sel || typeof sel !== 'string') return;
                        await invoke('export_history', { destPath: `${sel}\\migration_history.json` });
                        showToast('历史记录已导出', 'success');
                      } catch (e) { showToast(`导出失败: ${e}`, 'error'); }
                    }} className="btn h-7 text-[11px]">
                      <Database className="w-3 h-3" />导出
                    </button>
                    <button onClick={async () => {
                      try {
                        const sel = await open({ multiple: false, title: '选择历史记录文件', filters: [{ name: 'JSON', extensions: ['json'] }] });
                        if (!sel || typeof sel !== 'string') return;
                        const added = await invoke<number>('import_history', { srcPath: sel });
                        showToast(`已导入 ${added} 条新记录`, 'success'); await loadStats();
                      } catch (e) { showToast(`导入失败: ${e}`, 'error'); }
                    }} className="btn h-7 text-[11px]">
                      <Database className="w-3 h-3" />导入
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* help */}
        <section>
          <SectionHeader label="帮助" />
          <div className="rounded border" style={{ borderColor: 'var(--border-color)' }}>
            <button onClick={() => setManualOpen(true)}
              className="setting-item w-full text-left"
              style={{ padding: '10px 14px', cursor: 'pointer' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: 'var(--color-primary-light)' }}>
                  <BookOpen className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
                </div>
                <div>
                  <p className="setting-label">用户手册</p>
                  <p className="setting-desc">了解功能原理、软链接机制及使用协议</p>
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
            </button>
          </div>
        </section>

        {/* about */}
        <section>
          <SectionHeader label="关于" />
          <div className="rounded border" style={{ borderColor: 'var(--border-color)' }}>
            <div className="setting-item" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center overflow-hidden">
                  <img src={AppIconSvg} alt="" className="w-8 h-8" />
                </div>
                <div>
                  <p className="setting-label">{APP_INFO.name}</p>
                  <p className="setting-desc">{APP_INFO.description}</p>
                </div>
              </div>
              <span className="badge badge-primary">v{appVersion}</span>
            </div>
            {ABOUT_ITEMS.map((item) => (
              <div key={item.label} className="setting-item"
                style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-color)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: 'var(--bg-row-hover)' }}>
                    <item.icon className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                  </div>
                  <span className="text-[12px]" style={{ color: 'var(--text-primary)' }}>{item.label}</span>
                </div>
                <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{item.value}</span>
              </div>
            ))}
            {/* GitHub */}
            <a href="https://github.com/Chunyu33" target="_blank" rel="noopener noreferrer"
              className="setting-item no-underline"
              style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: 'var(--bg-row-hover)' }}>
                  <Github className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                </div>
                <span className="text-[12px]" style={{ color: 'var(--text-primary)' }}>GitHub</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>Chunyu33</span>
                <ExternalLink className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
              </div>
            </a>
            {/* Bilibili */}
            <a href="https://space.bilibili.com/387797235" target="_blank" rel="noopener noreferrer"
              className="setting-item no-underline"
              style={{ padding: '10px 14px', cursor: 'pointer' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: 'var(--bg-row-hover)' }}>
                  <Video className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                </div>
                <span className="text-[12px]" style={{ color: 'var(--text-primary)' }}>Bilibili</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>Evan的像素空间</span>
                <ExternalLink className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
              </div>
            </a>
          </div>
        </section>

        {/* copyright */}
        <div className="text-center py-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          &copy; {currentYear} {APP_INFO.name} · Evan Lau
        </div>
      </div>

      <UserManual isOpen={manualOpen} onClose={() => setManualOpen(false)} />
      <Toast message={toast.message} type={toast.type} visible={toast.visible} onClose={hideToast} />
    </div>
  );
}
