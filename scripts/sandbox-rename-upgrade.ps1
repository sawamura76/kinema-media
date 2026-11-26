<#
.SYNOPSIS
  Skrin installed over Kinema (the name until 0.17.0) keeps the library and
  leaves no Kinema behind: in Windows Sandbox, never on this PC.

.DESCRIPTION
  Installs Kinema (-Previous, a 0.16.0 or older setup, silently as winget
  would), plays a clip once so there is a library, offers it as a video
  player, pins its shortcut. Then runs the Skrin setup (-Mode Silent as winget
  does, or Passive: the setup's own pages without clicks) and starts Skrin
  once, without a self-test plan, so its launch moves the "Open with" offer.
  Says what is true after: Kinema's folder, Apps entry, shortcuts and pinned
  copy gone; Skrin's there; the library file the same file (creation time)
  and opened by Skrin (its log); the offer naming skrin.exe, Kinema's
  "Open with" name gone. Last a real uninstall, and what is left.

  Needs: Windows Sandbox switched on, the Skrin setup
  (src-tauri\target\release\bundle\nsis\*-setup.exe), Kinema's setup and a
  short clip. Results go to the staging folder's result.txt. ASCII only.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Previous,
    [Parameter(Mandatory = $true)][string]$Short,
    [string]$Installer = '',
    [ValidateSet('Silent', 'Passive')][string]$Mode = 'Silent',
    [int]$TimeoutMinutes = 20
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$sandbox = Join-Path $env:WINDIR 'System32\WindowsSandbox.exe'
if (-not (Test-Path $sandbox)) {
    throw 'Windows Sandbox is not switched on (Windows Features -> Windows Sandbox).'
}
$setup = if ($Installer) { @(Get-Item $Installer) } else { @(Get-ChildItem (Join-Path $root 'src-tauri\target\release\bundle\nsis\*-setup.exe')) }
if ($setup.Count -ne 1) { throw 'Expected one installer in src-tauri\target\release\bundle\nsis.' }

$stage = Join-Path $env:TEMP ('skrin-sandbox-rename-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory $stage | Out-Null
. (Join-Path $PSScriptRoot 'sandbox-common.ps1')
$webview = Add-SandboxWebView2 $stage
Copy-Item $setup[0].FullName (Join-Path $stage 'setup.exe')
Copy-Item $Previous (Join-Path $stage 'previous.exe')
Copy-Item $Short (Join-Path $stage 'short.mkv')
Set-Content -Path (Join-Path $stage 'mode.txt') -Value $(if ($Mode -eq 'Passive') { '/P' } else { '/S' }) -Encoding ASCII

$inside = 'C:\Users\WDAGUtilityAccount\Desktop\kinema'
@'
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here 'result.txt'
. (Join-Path $here 'webview2.ps1')
function Say($text) { Add-Content -Path $out -Value $text }
$oldDir = Join-Path $env:LOCALAPPDATA 'Kinema'
$newDir = Join-Path $env:LOCALAPPDATA 'Skrin'
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$desktop = [Environment]::GetFolderPath('Desktop')
$pinDir = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$apps = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$library = Join-Path $env:APPDATA 'com.kinema.app\library.db'
$appLog = Join-Path $env:APPDATA 'com.kinema.app\logs\app.log'
function Stamp($f) { if (Test-Path $f) { (Get-Item $f).CreationTimeUtc.Ticks } else { 'missing' } }
function RegLines($file) {
    if (-not (Test-Path $file)) { return @() }
    $key = ''
    Get-Content $file | ForEach-Object {
        if ($_ -like '[[]*') { $key = $_ }
        if ($_ -match '(?i)kinema|skrin|basswaves') { "$key  $_" }
    } | Select-Object -Unique
}
function Offer {
    $cmd = (Get-ItemProperty 'HKCU:\Software\Classes\Kinema.Video\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
    "RegisteredApplications $([bool](Get-ItemProperty HKCU:\Software\RegisteredApplications -Name Kinema -ErrorAction SilentlyContinue)); command: $cmd; Open-with names: kinema.exe $(Test-Path 'HKCU:\Software\Classes\Applications\kinema.exe'), skrin.exe $(Test-Path 'HKCU:\Software\Classes\Applications\skrin.exe') ($((Get-ItemProperty 'HKCU:\Software\Classes\Applications\skrin.exe' -ErrorAction SilentlyContinue).FriendlyAppName)); Default apps name: $((Get-ItemProperty 'HKCU:\Software\Kinema\Capabilities' -ErrorAction SilentlyContinue).ApplicationName)"
}
function State($label) {
    Say $label
    Say "  Apps: Kinema $((Get-ItemProperty "$apps\Kinema" -ErrorAction SilentlyContinue).DisplayVersion); Skrin $((Get-ItemProperty "$apps\Skrin" -ErrorAction SilentlyContinue).DisplayVersion)"
    Say "  folders: Kinema $(Test-Path $oldDir); Skrin $(Test-Path $newDir) (skrin.exe $(Test-Path (Join-Path $newDir 'skrin.exe')))"
    Say "  shortcuts: Kinema start $(Test-Path "$programs\Kinema.lnk"), desktop $(Test-Path "$desktop\Kinema.lnk"), pinned $(Test-Path "$pinDir\Kinema.lnk"); Skrin start $(Test-Path "$programs\Skrin.lnk"), desktop $(Test-Path "$desktop\Skrin.lnk")"
    Say "  library: $(Stamp $library), $(if (Test-Path $library) { (Get-Item $library).Length } else { 0 }) bytes"
    Say "  offer: $(Offer)"
}
function WaitIdle {
    $deadline = (Get-Date).AddSeconds(240)
    Start-Sleep -Seconds 5
    while ((Get-Date) -lt $deadline) {
        $busy = Get-Process | Where-Object { $_.ProcessName -match '^(setup|previous|Un|Un_\w*|Au_\w*|uninstall)$' }
        if (-not $busy) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}
Say "started $(Get-Date -Format s)"
try {
    $ProgressPreference = 'SilentlyContinue'
    New-Item -ItemType Directory 'C:\Videos' | Out-Null
    Copy-Item (Join-Path $here 'short.mkv') 'C:\Videos\Short clip.mkv'
    & reg export HKCU\Software (Join-Path $here 'before.reg') /y | Out-Null

    Say "0 WebView2 lent: $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"


    # 1. Kinema, installed silently, with a library, the offer and a pin.
    $p = Start-Process (Join-Path $here 'previous.exe') -ArgumentList '/S' -PassThru -Wait
    Say "1 Kinema installed: exit $($p.ExitCode)"
    New-Item -ItemType Directory $pinDir -Force | Out-Null
    if (Test-Path "$programs\Kinema.lnk") { Copy-Item "$programs\Kinema.lnk" "$pinDir\Kinema.lnk" -Force }
    # Started once as a person would: a self-test keeps its own library beside
    # its plan, so only a plain start makes the real one.
    $p = Start-Process (Join-Path $oldDir 'kinema.exe') -PassThru
    Start-Sleep -Seconds 20
    Say "  plain start: exited $($p.HasExited) $(if ($p.HasExited) { $p.ExitCode }); windows: $((Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.ProcessName)=$($_.MainWindowTitle)" }) -join ' | ')"
    Say "  web engine processes: $(@(Get-Process msedgewebview2 -ErrorAction SilentlyContinue).Count)"
    # The sandbox's own screen (never the host's), to see a dialog if there is one.
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save((Join-Path $here 'first-start.png'))
    Start-Sleep -Seconds 5
    Get-Process kinema -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
    $dir = Join-Path $env:TEMP 'plan-offer'
    New-Item -ItemType Directory $dir -Force | Out-Null
    $plan = @{ path = 'C:\Videos\Short clip.mkv'; fileId = $null; titleId = $null; seconds = 10;
        actions = @(@{ at = 2; do = 'call'; fn = 'offerAsPlayer' }, @{ at = 5; do = 'call'; fn = 'playerOffer' }) }
    [System.IO.File]::WriteAllText((Join-Path $dir 'plan.json'), ($plan | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding $false))
    $env:KINEMA_SELFTEST = Join-Path $dir 'plan.json'
    $p = Start-Process (Join-Path $oldDir 'kinema.exe') -PassThru
    Remove-Item Env:\KINEMA_SELFTEST
    $p.WaitForExit(60000) | Out-Null
    Say "  Kinema's self-test run: exited $($p.HasExited), code $(if ($p.HasExited) { $p.ExitCode })"
    Get-ChildItem (Join-Path $env:APPDATA 'com.kinema.app') -ErrorAction SilentlyContinue | ForEach-Object { Say "  data: $($_.Name)" }
    Get-Process SystemSettings -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-Process kinema -ErrorAction SilentlyContinue | Stop-Process -Force
    State '2 Kinema as an owner has it:'
    $libStamp = Stamp $library

    # 2. The Skrin setup over it.
    $mode = (Get-Content (Join-Path $here 'mode.txt')).Trim()
    $t0 = Get-Date
    $p = Start-Process (Join-Path $here 'setup.exe') -ArgumentList $mode -PassThru -Wait
    Say "3 Skrin setup $mode : exit $($p.ExitCode), finished $(WaitIdle) after $([int]((Get-Date) - $t0).TotalSeconds) s"
    State '  after the setup:'

    # 3. Skrin started once, as a person would (no plan, so its launch refresh runs).
    $logBefore = if (Test-Path $appLog) { (Get-Content $appLog).Count } else { 0 }
    $p = Start-Process (Join-Path $newDir 'skrin.exe') -PassThru
    Start-Sleep -Seconds 25
    Get-Process skrin -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
    State '4 after Skrin started once:'
    Say "  library is the same file: $((Stamp $library) -eq $libStamp)"
    $lines = if (Test-Path $appLog) { Get-Content $appLog } else { @() }
    $lines | Select-Object -Skip $logBefore | Where-Object { $_ -match 'started ---|library|default player|could not' } | Select-Object -First 12 | ForEach-Object { Say "  log: $_" }
    & reg export HKCU\Software (Join-Path $here 'upgraded.reg') /y | Out-Null
    Copy-Item (Join-Path $env:APPDATA 'com.kinema.app\logs') (Join-Path $here 'logs') -Recurse -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $env:TEMP 'plan-offer\data\logs') (Join-Path $here 'offer-logs') -Recurse -ErrorAction SilentlyContinue

    # 4. A real uninstall of Skrin leaves nothing of either name.
    $p = Start-Process (Join-Path $newDir 'uninstall.exe') -ArgumentList '/S' -PassThru -Wait
    Say "5 silent uninstall: exit $($p.ExitCode), finished $(WaitIdle)"
    State '  after uninstall:'
    & reg export HKCU\Software (Join-Path $here 'after.reg') /y | Out-Null
    $before = @(RegLines (Join-Path $here 'before.reg'))
    $after = @(RegLines (Join-Path $here 'after.reg'))
    Say "  registry lines naming Kinema or Skrin: before $($before.Count), after uninstall $($after.Count)"
    $after | Where-Object { $before -notcontains $_ } | ForEach-Object { Say "  left: $_" }
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
public static class SandboxWindow {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
}
'@
$other = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1
function Move-Sandbox {
    if (-not $other) { return }
    $handle = [SandboxWindow]::FindWindow('WindowsSandboxRemoteSession', $null)
    if ($handle -eq [IntPtr]::Zero) {
        $p = Get-Process WindowsSandboxRemoteSession, WindowsSandboxClient -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
        if ($p) { $handle = $p.MainWindowHandle }
    }
    if ($handle -ne [IntPtr]::Zero) {
        $a = $other.WorkingArea
        [SandboxWindow]::SetWindowPos($handle, [IntPtr]::Zero, $a.X + 20, $a.Y + 20, [Math]::Min(1600, $a.Width - 40), [Math]::Min(900, $a.Height - 40), 0x0014) | Out-Null
    }
}

Write-Host "Starting Windows Sandbox (staging: $stage)"
Start-Process $sandbox -ArgumentList "`"$wsb`""
foreach ($wait in 4, 4, 8, 8, 15) { Start-Sleep -Seconds $wait; Move-Sandbox }

$result = Join-Path $stage 'result.txt'
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
while ((Get-Date) -lt $deadline) {
    # The sandbox may be writing the file at that moment: a read it refuses
    # is not the end, only a try for the next round.
    $done = try { (Test-Path $result) -and (Select-String -Path $result -Pattern '^DONE$' -Quiet -ErrorAction Stop) } catch { $false }
    if ($done) { break }
    Start-Sleep -Seconds 10
    Move-Sandbox
}
if (Test-Path $result) { Get-Content $result } else { Write-Host 'No result was written.' }
if (Get-Command wsb -ErrorAction SilentlyContinue) {
    $running = (wsb list --raw | ConvertFrom-Json).WindowsSandboxEnvironments
    foreach ($box in $running) { wsb stop --id $(if ($box.Id) { $box.Id } else { $box }) | Out-Null }
}
Get-Process WindowsSandbox, WindowsSandboxClient, WindowsSandboxRemoteSession -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Result kept in $result"
