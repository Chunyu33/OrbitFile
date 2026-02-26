// 设置页面
// 企业级模块化设计

import { useState } from 'react';
import { FolderCog, Shield, CheckCircle, Info, ChevronRight } from 'lucide-react';

// 开关组件
function Toggle({ active, onChange }: { active: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`toggle ${active ? 'active' : ''}`}
      style={{
        width: '44px',
        height: '24px',
        background: active ? 'var(--color-primary)' : 'var(--color-gray-300)',
        borderRadius: 'var(--radius-full)',
        position: 'relative',
        transition: 'background var(--transition-fast)',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: active ? '22px' : '2px',
          width: '20px',
          height: '20px',
          background: 'white',
          borderRadius: 'var(--radius-full)',
          boxShadow: 'var(--shadow-sm)',
          transition: 'left var(--transition-fast)',
        }}
      />
    </button>
  );
}

export default function Settings() {
  const [backupEnabled, setBackupEnabled] = useState(true);
  const [verifyEnabled, setVerifyEnabled] = useState(true);

  return (
    <div className="h-full overflow-auto" style={{ padding: 'var(--page-padding)' }}>
      <div className="max-w-3xl mx-auto" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}>
        {/* 标题 */}
        <header>
          <h1 className="page-title">设置</h1>
          <p className="page-subtitle">配置应用迁移选项和偏好</p>
        </header>

        {/* 迁移设置 */}
        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
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
          <div className="setting-item" style={{ padding: 'var(--spacing-4) var(--spacing-5)', margin: 0, borderBottom: '1px solid var(--border-color)' }}>
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
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)' }}>D:\Apps</span>
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </div>
          </div>

          {/* 迁移前备份 */}
          <div className="setting-item" style={{ padding: 'var(--spacing-4) var(--spacing-5)', margin: 0, borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
              <div 
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--color-success-light)' }}
              >
                <Shield className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
              </div>
              <div>
                <p className="setting-label">迁移前创建备份</p>
                <p className="setting-desc">在迁移前自动备份原始文件</p>
              </div>
            </div>
            <Toggle active={backupEnabled} onChange={() => setBackupEnabled(!backupEnabled)} />
          </div>

          {/* 验证完整性 */}
          <div className="setting-item" style={{ padding: 'var(--spacing-4) var(--spacing-5)', margin: 0, border: 'none' }}>
            <div className="flex items-center" style={{ gap: 'var(--spacing-3)' }}>
              <div 
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--color-warning-light)' }}
              >
                <CheckCircle className="w-4 h-4" style={{ color: 'var(--color-warning)' }} />
              </div>
              <div>
                <p className="setting-label">验证文件完整性</p>
                <p className="setting-desc">迁移后校验文件哈希值</p>
              </div>
            </div>
            <Toggle active={verifyEnabled} onChange={() => setVerifyEnabled(!verifyEnabled)} />
          </div>
        </section>

        {/* 关于 */}
        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
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
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--color-primary)' }}
              >
                <span style={{ color: 'white', fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-sm)' }}>O</span>
              </div>
              <div>
                <p className="setting-label">OrbitFile</p>
                <p className="setting-desc">专业的 Windows 存储重定向工具</p>
              </div>
            </div>
            <span className="badge badge-primary">v0.1.0</span>
          </div>

          <div className="setting-item" style={{ padding: 'var(--spacing-4) var(--spacing-5)', margin: 0, borderBottom: '1px solid var(--border-color)' }}>
            <span className="setting-label">技术栈</span>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)' }}>Tauri + Rust + React</span>
          </div>

          <div className="setting-item" style={{ padding: 'var(--spacing-4) var(--spacing-5)', margin: 0, border: 'none' }}>
            <span className="setting-label">UI 框架</span>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)' }}>Tailwind CSS</span>
          </div>
        </section>

        {/* 提示 */}
        <div 
          className="flex items-center justify-center" 
          style={{ 
            gap: 'var(--spacing-2)', 
            padding: 'var(--spacing-4)',
            color: 'var(--text-muted)',
            fontSize: 'var(--font-size-xs)'
          }}
        >
          <Info className="w-4 h-4" />
          <span>更多设置选项将在后续版本中开放</span>
        </div>
      </div>
    </div>
  );
}
