#!/usr/bin/env bash
# IMDb's list of titles built on Android (round 11, P2a): the debug build on
# the emulator downloads and filters the two files through the real command,
# while the app's resident memory is read every few seconds from the side.
# Prints the time, the list's rows and size, and the app's memory before,
# highest during, and its peak as the kernel kept it (VmHWM).
#
#   bash scripts/android-bench.sh ready, then in WSL (the kit's copy):
#   powershell.exe -File scripts/wsl.ps1 -Mirror kinema-android 'bash scripts/proof/android-imdb-titles.sh'
#
# Emulator only (the kit's default target). Uses a few hundred MB of the
# emulator's network and storage; the list stays in the app's data folder.
set -euo pipefail
kit="$(cd "$(dirname "$0")/.." && pwd)/android-bench.sh"
adb="$(command -v adb || echo "${ANDROID_HOME:-$HOME/Android}/platform-tools/adb")"
serial="$("$adb" devices | awk '/^emulator-/ {print $1; exit}')"
# What `ready` installed, started afresh (its library stays).
"$adb" -s "$serial" shell am force-stop com.kinema.app
"$adb" -s "$serial" shell monkey -p com.kinema.app -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null 2>&1
for _ in $(seq 1 60); do
  [ "$(bash "$kit" page eval '!!(window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke)' 2>/dev/null)" = true ] && break
  sleep 2
done
pid="$("$adb" -s "$serial" shell pidof com.kinema.app | tr -d '\r')"
rss() { "$adb" -s "$serial" shell grep -E "^$1:" "/proc/$pid/status" | awk '{print $2}'; }
before="$(rss VmRSS)"; hwm_before="$(rss VmHWM)"
bash "$kit" page eval "(() => { const i = window.__TAURI_INTERNALS__.invoke;
  window.__imdb = 'running';
  i('set_setting', { key: 'imdb_titles_allowed', value: '1' })
    .then(() => i('refresh_imdb_titles', { force: true }))
    .then(r => { window.__imdb = JSON.stringify(r); }, e => { window.__imdb = 'error: ' + e; });
  return 'started'; })()" >/dev/null
start=$(date +%s); high="$before"
while :; do
  sleep 3
  now="$(rss VmRSS)"; [ "$now" -gt "$high" ] && high="$now"
  state="$(bash "$kit" page eval 'window.__imdb' 2>/dev/null || echo running)"
  case "$state" in *running*) ;; *) break ;; esac
  [ $(( $(date +%s) - start )) -gt 3600 ] && { state="timed out"; break; }
done
took=$(( $(date +%s) - start ))
status="$(bash "$kit" page eval "window.__TAURI_INTERNALS__.invoke('imdb_titles_status').then(s => JSON.stringify(s))")"
echo "result:  $state"
echo "status:  $status"
echo "time:    ${took}s"
echo "memory:  ${before} kB before, ${high} kB highest seen, VmHWM ${hwm_before} -> $(rss VmHWM) kB"
