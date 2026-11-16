param(
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [Parameter(Mandatory = $false)][string]$ExePath = ''
)

$ErrorActionPreference = 'Stop'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("inova-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

function Get-UserPathEntries {
  $envKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $false)
  if (-not $envKey) { return @() }
  try {
    $raw = [string]$envKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    return @($raw -split ';' | Where-Object { $_ -ne '' })
  } finally {
    $envKey.Close()
  }
}

try {
  Expand-Archive -Path $ZipPath -DestinationPath $tmp -Force
  $exeItem = Get-ChildItem -Path $tmp -Filter 'InovaIDE.exe' -Recurse -File | Select-Object -First 1
  if (-not $exeItem) {
    throw 'InovaIDE.exe not found in extracted zip'
  }

  $appDir = $exeItem.DirectoryName
  $outFile = Join-Path $tmp 'selftest-out.txt'
  $errFile = Join-Path $tmp 'selftest-err.txt'

  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $env:INOVA_SELFTEST = '1'
  $proc = Start-Process -FilePath $exeItem.FullName -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  Remove-Item Env:INOVA_SELFTEST -ErrorAction SilentlyContinue

  $out = if (Test-Path $outFile) { Get-Content $outFile -Raw } else { '' }
  $err = if (Test-Path $errFile) { Get-Content $errFile -Raw } else { '' }
  Write-Output $out
  if ($proc.ExitCode -ne 0) {
    throw "Selftest exited with $($proc.ExitCode): $err"
  }
  if ($out -notmatch 'selftest:pty-ok:claude,codex,gemini') {
    throw "Unexpected selftest output: $out"
  }

  $cli = Join-Path $appDir 'resources\bin\inova.cmd'
  $cliVer = (& $cli --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "inova.cmd --version failed with $LASTEXITCODE"
  }
  if ($cliVer -ne $ExpectedVersion) {
    throw "Expected CLI version $ExpectedVersion, got $cliVer"
  }

  & $cli --help | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "inova.cmd --help failed with $LASTEXITCODE"
  }

  if ($ExePath -ne '') {
    $installDir = Join-Path $tmp 'nsis-install'
    $installProc = Start-Process -FilePath $ExePath -ArgumentList '/S', "/D=$installDir" -Wait -PassThru
    if ($installProc.ExitCode -ne 0) {
      throw "NSIS silent install exited with $($installProc.ExitCode)"
    }

    $regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\d7a4c9e2-6b3f-4c81-9f2a-1e5b8a4d7c03'
    if (-not (Test-Path $regPath)) {
      throw "Missing NSIS Uninstall registry key: $regPath"
    }
    $regProps = Get-ItemProperty -Path $regPath
    if ($regProps.DisplayName -ne 'InovaIDE') {
      throw "Expected DisplayName InovaIDE, got $($regProps.DisplayName)"
    }
    if ($regProps.DisplayVersion -ne $ExpectedVersion) {
      throw "Expected DisplayVersion $ExpectedVersion, got $($regProps.DisplayVersion)"
    }

    $installedBin = Join-Path $installDir 'resources\bin'
    $pathEntries = Get-UserPathEntries
    if ($pathEntries -notcontains $installedBin) {
      throw "Expected $installedBin in HKCU:\Environment\Path"
    }

    $installedCli = Join-Path $installedBin 'inova.cmd'
    $installedCliVer = (& $installedCli --version | Out-String).Trim()
    if ($installedCliVer -ne $ExpectedVersion) {
      throw "Expected installed CLI version $ExpectedVersion, got $installedCliVer"
    }

    $uninstaller = Join-Path $installDir 'Uninstall InovaIDE.exe'
    $uninstallProc = Start-Process -FilePath $uninstaller -ArgumentList '/S', "_?=$installDir" -Wait -PassThru
    if ($uninstallProc.ExitCode -ne 0) {
      throw "NSIS silent uninstall exited with $($uninstallProc.ExitCode)"
    }
    if (Test-Path $regPath) {
      throw "NSIS Uninstall registry key still present after uninstall: $regPath"
    }
    $afterUninstallPath = Get-UserPathEntries
    if ($afterUninstallPath -contains $installedBin) {
      throw "Expected $installedBin removed from HKCU:\Environment\Path after uninstall"
    }
  }
} finally {
  Remove-Item Env:INOVA_SELFTEST -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
