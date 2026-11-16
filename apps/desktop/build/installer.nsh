!macro customInstall
  System::Call 'Kernel32::SetEnvironmentVariable(t "INOVA_BIN_DIR", t "$INSTDIR\resources\bin")'
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$bin = $$env:INOVA_BIN_DIR; if ($$bin) { $$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); if ($$k) { $$raw = [string]$$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $$kind = try { $$k.GetValueKind('Path') } catch { [Microsoft.Win32.RegistryValueKind]::ExpandString }; $$parts = @($$raw -split ';' | Where-Object { $$_ -ne '' -and $$_.TrimEnd('\') -ine $$bin.TrimEnd('\') }); $$parts += $$bin; $$k.SetValue('Path', ($$parts -join ';'), $$kind); $$k.Close() } }"`
  Pop $0
  System::Call "user32::SendMessageTimeout(i 0xffff, i 0x001a, i 0, t 'Environment', i 2, i 5000, *i .r0)"
!macroend

!macro customUnInstall
  System::Call 'Kernel32::SetEnvironmentVariable(t "INOVA_BIN_DIR", t "$INSTDIR\resources\bin")'
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$bin = $$env:INOVA_BIN_DIR; if ($$bin) { $$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $$true); if ($$k) { $$raw = [string]$$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $$kind = try { $$k.GetValueKind('Path') } catch { [Microsoft.Win32.RegistryValueKind]::ExpandString }; $$parts = @($$raw -split ';' | Where-Object { $$_ -ne '' -and $$_.TrimEnd('\') -ine $$bin.TrimEnd('\') }); if ($$parts.Count -eq 0) { $$k.DeleteValue('Path', $$false) } else { $$k.SetValue('Path', ($$parts -join ';'), $$kind) }; $$k.Close() } }"`
  Pop $0
  System::Call "user32::SendMessageTimeout(i 0xffff, i 0x001a, i 0, t 'Environment', i 2, i 5000, *i .r0)"
!macroend
