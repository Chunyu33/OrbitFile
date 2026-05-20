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
            // 内联完整清单，包含 Common Controls v6 依赖和 Windows 10+ 兼容性声明
            // 缺失 Common Controls 会导致 TaskDialogIndirect 等 API 入口点定位失败
            let windows = tauri_build::WindowsAttributes::new()
                .app_manifest(r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity
    version="1.0.0.0"
    processorArchitecture="*"
    name="com.chunyu.viap"
    type="win32"
  />
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="highestAvailable" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}"/>
      <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}"/>
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
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
