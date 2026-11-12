param(
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("inova-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

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
} finally {
  Remove-Item Env:INOVA_SELFTEST -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
