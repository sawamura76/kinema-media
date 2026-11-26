<#
  Shared by every scripts\sandbox-*.ps1. Dot-source it; never run it alone.

  Windows Sandbox has no WebView2, the web engine the app draws with. Started
  there without it, the app shows "Could not find the WebView2 Runtime" (an
  error box, with its sound) and does nothing else, so a test proves nothing.
  Setting only the EdgeUpdate registry value is not enough: the setups check
  that value and pass, but the app's own WebView2 loader does not find the
  engine by it (2026-11-14, many sandbox runs lost to this).

  So this PC's own WebView2 is lent to the sandbox, read-only, and named the
  way the app looks for it: WEBVIEW2_BROWSER_EXECUTABLE_FOLDER, set
  machine-wide so a program a setup starts sees it too, plus the EdgeUpdate
  value the setups check (so they do not try to download WebView2).

  Outer script:
      . (Join-Path $PSScriptRoot 'sandbox-common.ps1')
      $webview = Add-SandboxWebView2 $stage
      ... and $($webview.Mapping) inside the .wsb's <MappedFolders>.
  Inner script, right after $here is set and before any app or setup runs:
      . (Join-Path $here 'webview2.ps1')
  If the engine is not there inside the sandbox, that stops the run with a
  line in result.txt (and DONE) before any app can open the error box.
#>

function Add-SandboxWebView2([Parameter(Mandatory = $true)][string]$Stage) {
    $root = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'
    $v = Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d+(\.\d+){3}$' -and (Test-Path (Join-Path $_.FullName 'msedgewebview2.exe')) } |
        Sort-Object { [version]$_.Name } | Select-Object -Last 1
    if (-not $v) { throw "No WebView2 on this PC to lend the sandbox (looked in $root)." }
    $inner = @"
# Written by sandbox-common.ps1: this PC's WebView2 $($v.Name), lent read-only.
`$wvDir = '$($v.FullName)'
if (-not (Test-Path (Join-Path `$wvDir 'msedgewebview2.exe'))) {
    Add-Content -Path (Join-Path `$here 'result.txt') -Value "WebView2 not found at `$wvDir inside the sandbox: stopped before starting any app."
    Add-Content -Path (Join-Path `$here 'result.txt') -Value 'DONE'
    exit 1
}
& reg add 'HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' /v pv /t REG_SZ /d '$($v.Name)' /f | Out-Null
[Environment]::SetEnvironmentVariable('WEBVIEW2_BROWSER_EXECUTABLE_FOLDER', `$wvDir, 'Machine')
`$env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = `$wvDir
"@
    [System.IO.File]::WriteAllText((Join-Path $Stage 'webview2.ps1'), $inner, (New-Object System.Text.UTF8Encoding $false))
    [pscustomobject]@{
        Version = $v.Name
        Folder  = $v.FullName
        Mapping = "<MappedFolder><HostFolder>$($v.FullName)</HostFolder><SandboxFolder>$($v.FullName)</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>"
    }
}
