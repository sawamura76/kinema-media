<#
.SYNOPSIS
  The update button, end to end, in Windows Sandbox: an installed older Skrin
  updates itself to a test release served on the sandbox's own loopback
  address. Never on this PC.

.DESCRIPTION
  Installs -Old silently and starts it once (so a library exists), then serves
  a test release in GitHub's shape on http://127.0.0.1:8765 inside the sandbox
  (-New as skrin-windows-x64-setup.exe with its .sha256) and points the old
  copy at it with SKRIN_UPDATE_FEED (updates.rs accepts only loopback). Two
  self-test plans press "Update" through the app's own commands
  (latest_release, install_update):
    1. with a wrong checksum: refused, nothing installed;
    2. with the right one: the setup starts, Skrin closes, the setup replaces
       it; then the version in Apps, the library, and what the app logged.
  Last it uninstalls silently. Results: the staging folder's result.txt.
  ASCII only (see build-app.ps1).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Old,
    [Parameter(Mandatory = $true)][string]$New,
    [Parameter(Mandatory = $true)][string]$Short,
    [int]$TimeoutMinutes = 20
)

$ErrorActionPreference = 'Stop'
$sandbox = Join-Path $env:WINDIR 'System32\WindowsSandbox.exe'
if (-not (Test-Path $sandbox)) { throw 'Windows Sandbox is not switched on.' }

$stage = Join-Path $env:TEMP ('skrin-sandbox-selfupdate-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory $stage | Out-Null
. (Join-Path $PSScriptRoot 'sandbox-common.ps1')
$webview = Add-SandboxWebView2 $stage
Copy-Item $Old (Join-Path $stage 'old.exe')
Copy-Item $New (Join-Path $stage 'new.exe')
Copy-Item $Short (Join-Path $stage 'short.mkv')
$newVersion = (Get-Item $New).VersionInfo.ProductVersion
if (-not $newVersion) { $newVersion = (Get-Item $New).VersionInfo.FileVersion }
Set-Content -Path (Join-Path $stage 'newversion.txt') -Value $newVersion -Encoding ASCII

$inside = 'C:\Users\WDAGUtilityAccount\Desktop\kinema'
@'
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here 'result.txt'
. (Join-Path $here 'webview2.ps1')
function Say($text) { Add-Content -Path $out -Value $text }
$installDir = Join-Path $env:LOCALAPPDATA 'Skrin'
$exe = Join-Path $installDir 'skrin.exe'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Skrin'
$library = Join-Path $env:APPDATA 'com.kinema.app\library.db'
$utf8 = New-Object System.Text.UTF8Encoding $false
function Version { "Apps $((Get-ItemProperty $uninstallKey -ErrorAction SilentlyContinue).DisplayVersion), program $((Get-Item $exe -ErrorAction SilentlyContinue).VersionInfo.FileVersion)" }
function WaitIdle {
    $deadline = (Get-Date).AddSeconds(240)
    Start-Sleep -Seconds 5
    while ((Get-Date) -lt $deadline) {
        $busy = Get-Process | Where-Object { $_.ProcessName -match '^(skrin-windows-x64-setup|new|old|Un|Un_\w*|Au_\w*|uninstall)$' }
        if (-not $busy) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}
function Plan($name, $feed) {
    $dir = Join-Path $env:TEMP "plan-$name"
    New-Item -ItemType Directory $dir -Force | Out-Null
    $plan = @{ path = 'C:\Videos\Short clip.mkv'; fileId = $null; titleId = $null; seconds = 40;
        actions = @(@{ at = 2; do = 'call'; fn = 'latestRelease' }, @{ at = 4; do = 'call'; fn = 'installUpdate' }) }
    [System.IO.File]::WriteAllText((Join-Path $dir 'plan.json'), ($plan | ConvertTo-Json -Depth 5), $utf8)
    $env:KINEMA_SELFTEST = Join-Path $dir 'plan.json'
    $env:SKRIN_UPDATE_FEED = $feed
    $p = Start-Process $exe -PassThru
    Remove-Item Env:\KINEMA_SELFTEST, Env:\SKRIN_UPDATE_FEED
    $exited = $p.WaitForExit(90000)
    Say "  Skrin ended by itself: $exited (exit $(if ($exited) { $p.ExitCode }))"
    Get-Process skrin -ErrorAction SilentlyContinue | Stop-Process -Force
    $report = Join-Path $dir 'report.json'
    if (Test-Path $report) {
        $r = Get-Content $report -Raw | ConvertFrom-Json
        $r.timeline | Where-Object { $_.kind -like 'call:*' } | ForEach-Object { Say "  report: $($_.kind) $($_.detail | ConvertTo-Json -Compress -Depth 6)" }
    } else { Say '  report: none (the app closed for the installer before the plan ended)' }
    Get-ChildItem $dir -Recurse -Filter 'app*.log' -ErrorAction SilentlyContinue | ForEach-Object {
        Select-String -Path $_.FullName -Pattern 'updates:' | ForEach-Object { Say "  log: $($_.Line.Trim())" }
    }
}

Say "started $(Get-Date -Format s)"
try {
    $ProgressPreference = 'SilentlyContinue'
    New-Item -ItemType Directory 'C:\Videos' | Out-Null
    Copy-Item (Join-Path $here 'short.mkv') 'C:\Videos\Short clip.mkv'

    # 1. The older copy, installed silently and started once: a library exists.
    $p = Start-Process (Join-Path $here 'old.exe') -ArgumentList '/S' -PassThru -Wait
    Say "1 old copy installed: exit $($p.ExitCode); $(Version); uninstall.exe beside it: $(Test-Path (Join-Path $installDir 'uninstall.exe'))"
    $p = Start-Process $exe -PassThru
    Start-Sleep -Seconds 20
    Get-Process skrin -ErrorAction SilentlyContinue | Stop-Process -Force
    $libBefore = if (Test-Path $library) { (Get-FileHash $library).Hash } else { 'missing' }
    Say "  library after a first start: $(if (Test-Path $library) { 'there' } else { 'missing' })"

    # 2. A test release on loopback, in GitHub's shape.
    $feed = Join-Path $here 'feed'
    New-Item -ItemType Directory $feed -Force | Out-Null
    $version = (Get-Content (Join-Path $here 'newversion.txt') -Raw).Trim()
    Copy-Item (Join-Path $here 'new.exe') (Join-Path $feed 'skrin-windows-x64-setup.exe')
    $hash = (Get-FileHash (Join-Path $feed 'skrin-windows-x64-setup.exe')).Hash.ToLower()
    [IO.File]::WriteAllText((Join-Path $feed 'good.sha256'), "$hash  skrin-windows-x64-setup.exe`n", $utf8)
    [IO.File]::WriteAllText((Join-Path $feed 'bad.sha256'), "$('0' * 64)  skrin-windows-x64-setup.exe`n", $utf8)
    foreach ($kind in 'good', 'bad') {
        $json = @{ tag_name = "v$version"; html_url = 'https://github.com/basswaves/skrin/releases'; draft = $false; prerelease = $false;
            assets = @(
                @{ name = 'skrin-windows-x64-setup.exe'; browser_download_url = 'http://127.0.0.1:8765/skrin-windows-x64-setup.exe' },
                @{ name = 'skrin-windows-x64-setup.exe.sha256'; browser_download_url = "http://127.0.0.1:8765/$kind.sha256" }) }
        [IO.File]::WriteAllText((Join-Path $feed "$kind.json"), ($json | ConvertTo-Json -Depth 5), $utf8)
    }
    $server = Start-Job -ArgumentList $feed -ScriptBlock {
        param($root)
        $l = New-Object System.Net.HttpListener
        $l.Prefixes.Add('http://127.0.0.1:8765/')
        $l.Start()
        while ($true) {
            $c = $l.GetContext()
            $f = Join-Path $root ($c.Request.Url.AbsolutePath.TrimStart('/'))
            if (Test-Path $f -PathType Leaf) {
                $bytes = [IO.File]::ReadAllBytes($f)
                $c.Response.ContentLength64 = $bytes.Length
                $c.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else { $c.Response.StatusCode = 404 }
            $c.Response.Close()
        }
    }
    Start-Sleep -Seconds 3
    Say "2 test release v$version served on loopback (server $($server.State))"

    # 3. A wrong checksum: refused, nothing installed.
    Say '3 update with a wrong checksum:'
    Plan 'bad' 'http://127.0.0.1:8765/bad.json'
    Say "  after: $(Version)"

    # 4. The right one: the setup starts, Skrin closes, the setup replaces it.
    Say '4 update with the right checksum:'
    $t0 = Get-Date
    Plan 'good' 'http://127.0.0.1:8765/good.json'
    Say "  setup finished: $(WaitIdle) after $([int]((Get-Date) - $t0).TotalSeconds) s"
    Start-Sleep -Seconds 10
    Say "  Skrin started again at the end: $([bool](Get-Process skrin -ErrorAction SilentlyContinue))"
    Get-Process skrin -ErrorAction SilentlyContinue | Stop-Process -Force
    Say "  after: $(Version)"
    $libAfter = if (Test-Path $library) { 'there' } else { 'missing' }
    Say "  library after the update: $libAfter (same bytes as before: $((Test-Path $library) -and ((Get-FileHash $library).Hash -eq $libBefore)))"
    Stop-Job $server; Remove-Job $server -Force

    # 5. A silent uninstall, as before.
    $p = Start-Process (Join-Path $installDir 'uninstall.exe') -ArgumentList '/S' -PassThru -Wait
    Say "5 silent uninstall: exit $($p.ExitCode), finished $(WaitIdle); install folder there: $(Test-Path $installDir)"
} catch {
    Say "script failed: $_"
}
Say 'DONE'
'@ | Set-Content -Path (Join-Path $stage 'inner.ps1') -Encoding UTF8

$wsb = Join-Path $stage 'kinema.wsb'
@"
<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$stage</HostFolder>
      <SandboxFolder>$inside</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
    $($webview.Mapping)
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File $inside\inner.ps1</Command>
  </LogonCommand>
</Configuration>
"@ | Set-Content -Path $wsb -Encoding UTF8

# The sandbox's window, off the primary screen the owner works on.
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SandboxWindow2 {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
}
'@
$other = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1
function Move-Sandbox {
    if (-not $other) { return }
    $handle = [SandboxWindow2]::FindWindow('WindowsSandboxRemoteSession', $null)
    if ($handle -eq [IntPtr]::Zero) {
        $p = Get-Process WindowsSandboxRemoteSession, WindowsSandboxClient -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
        if ($p) { $handle = $p.MainWindowHandle }
    }
    if ($handle -ne [IntPtr]::Zero) {
        $a = $other.WorkingArea
        [SandboxWindow2]::SetWindowPos($handle, [IntPtr]::Zero, $a.X + 20, $a.Y + 20, [Math]::Min(1600, $a.Width - 40), [Math]::Min(900, $a.Height - 40), 0x0014) | Out-Null
    }
}

Write-Host "Starting Windows Sandbox (staging: $stage)"
Start-Process $sandbox -ArgumentList "`"$wsb`""
foreach ($wait in 4, 4, 8, 8, 15) { Start-Sleep -Seconds $wait; Move-Sandbox }

$result = Join-Path $stage 'result.txt'
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
while ((Get-Date) -lt $deadline) {
    $done = try { (Test-Path $result) -and (Select-String -Path $result -Pattern '^DONE$' -Quiet -ErrorAction Stop) } catch { $false }
    if ($done) { break }
    Start-Sleep -Seconds 10
    Move-Sandbox
}
if (Test-Path $result) { Get-Content $result } else { Write-Host 'No result was written.' }
