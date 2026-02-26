fn main() {
    // 配置 Windows 平台请求管理员权限
    // 注意：在 release 构建时启用 highestAvailable，开发时使用 asInvoker
    #[cfg(windows)]
    {
        // 根据构建模式选择不同的权限级别
        // release 模式：请求最高可用权限（用于文件迁移操作）
        // debug 模式：使用调用者权限（便于开发调试）
        #[cfg(not(debug_assertions))]
        {
            let windows = tauri_build::WindowsAttributes::new()
                .app_manifest(r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="highestAvailable" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
"#);
            tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
                .expect("failed to run build script");
        }
        
        #[cfg(debug_assertions)]
        {
            tauri_build::build();
        }
    }
    
    #[cfg(not(windows))]
    {
        tauri_build::build();
    }
}
