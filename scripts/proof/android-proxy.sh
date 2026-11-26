#!/usr/bin/env bash
# The proxy setting on Android, direct connections included (round 11): the
# debug build on the emulator makes lookups with the proxy off (CONTROL: the
# sampler must see the app connect straight out) and on (every request a line
# in the proxy's log, NO direct connection from the app's uid), while the
# app's TCP sockets are read from /proc/net/tcp every 0.4 s.
#
#   bash scripts/android-bench.sh ready, then in WSL (the kit's copy):
#   powershell.exe -File scripts/wsl.ps1 -Mirror kinema-android 'bash scripts/proof/android-proxy.sh'
#
# The emulator reaches WSL's loopback as 10.0.2.2, where the logging proxy
# (scripts/proxy-log.mjs) listens. Lookups used (the debug build's hooks and
# commands): GitHub's release feed (the update check), two pictures fetched
# the way the page fetches them (TMDB's image host, TVmaze's), and the
# Check button's own test. Emulator only. Exit 0 when the control went direct,
# the proxied run did not, and the proxy saw the lookups.
set -euo pipefail
kit="$(cd "$(dirname "$0")/.." && pwd)/android-bench.sh"
adb="$(command -v adb || echo "${ANDROID_HOME:-$HOME/Android}/platform-tools/adb")"
serial="$("$adb" devices | awk '/^emulator-/ {print $1; exit}')"
a() { "$adb" -s "$serial" "$@"; }
port=18083; out="$(mktemp -d)"
page() { bash "$kit" page eval "$1"; }
ready() {
  a shell am force-stop com.kinema.app
  a shell monkey -p com.kinema.app -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null 2>&1
  for _ in $(seq 1 60); do
    [ "$(page '!!(window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke && window.__kinemaSelfTest)' 2>/dev/null)" = true ] && return 0
    sleep 2
  done
  echo "the page did not come up" >&2; return 1
}
uid="$(a shell pm list packages -U com.kinema.app | tr -d '\r' | sed -E 's/.*uid:([0-9]+).*/\1/')"
# Remote endpoints of the app's sockets that are not the proxy, loopback or the emulator's own 10.0.2.x.
sample() { # file ; runs until killed
  while :; do
    a shell cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | tr -d '\r' | python3 -I -c '
import sys
uid = sys.argv[1]
for line in sys.stdin:
    f = line.split()
    if len(f) < 8 or not f[1].endswith(("0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F")) or f[0] == "sl": continue
    if f[7] != uid or f[3] != "01": continue          # this app, ESTABLISHED
    rem, port = f[2].split(":")
    if len(rem) == 8:                                   # IPv4, little-endian hex
        ip = ".".join(str(int(rem[i:i+2], 16)) for i in (6, 4, 2, 0))
    else:                                               # IPv6: mapped IPv4 or other
        ip = rem
        if rem[16:24] == "0000FFFF":
            ip = ".".join(str(int(rem[24:][i:i+2], 16)) for i in (6, 4, 2, 0))
    if ip.startswith(("127.", "10.0.2.")) or ip in ("0.0.0.0",) or set(rem) <= {"0"}: continue
    print(ip + ":" + str(int(port, 16)))
' "$uid" >> "$1" || true
    sleep 0.4
  done
}
lookups() {
  page "(() => { const i = window.__TAURI_INTERNALS__.invoke; window.__lk = [];
    const note = (n) => (r) => window.__lk.push(n + ': ' + (typeof r === 'string' ? r.slice(0, 60) : 'ok'));
    const bad = (n) => (e) => window.__lk.push(n + ' failed: ' + String(e).slice(0, 80));
    window.__kinemaSelfTest.call('latestRelease').then(note('github'), bad('github'));
    i('fetch_remote_image', { url: 'https://image.tmdb.org/t/p/w92/zzzzzz.jpg' }).then(note('tmdb image'), bad('tmdb image'));
    i('fetch_remote_image', { url: 'https://static.tvmaze.com/uploads/images/medium_portrait/0/1.jpg' }).then(note('tvmaze image'), bad('tvmaze image'));
    i('check_proxy', { address: 'http://10.0.2.2:$port' }).then(note('check'), bad('check'));
    return 'started'; })()" >/dev/null
  sleep 25
  page "JSON.stringify(window.__lk)"
}
run() { # name proxy(0/1)
  local name=$1 on=$2
  : > "$out/$name.direct"
  ready
  page "(async () => { const i = window.__TAURI_INTERNALS__.invoke;
    await i('set_setting', { key: 'proxy_address', value: 'http://10.0.2.2:$port' });
    await i('set_setting', { key: 'proxy_enabled', value: '$( [ "$on" = 1 ] && echo on || echo off )' }); return 'set'; })()" >/dev/null
  sample "$out/$name.direct" & local spid=$!
  echo "--- $name: lookups"; lookups
  kill $spid 2>/dev/null || true; wait $spid 2>/dev/null || true
  sort -u "$out/$name.direct" -o "$out/$name.direct"
}
node "$(dirname "$kit")/proxy-log.mjs" --port $port --log "$out/proxy.log" >/dev/null & ppid=$!
trap 'kill $ppid 2>/dev/null || true' EXIT
sleep 1
run control 0
: > "$out/proxy.log"
run proxied 1
echo "--- control (proxy off): direct endpoints seen"; head -5 "$out/control.direct"
echo "--- proxied: direct endpoints seen"; cat "$out/proxied.direct"
echo "--- proxied: proxy log"; awk '{print $3}' "$out/proxy.log" | sort | uniq -c
c=$(wc -l < "$out/control.direct"); d=$(wc -l < "$out/proxied.direct"); p=$(wc -l < "$out/proxy.log")
echo "control direct: $c | proxied direct: $d | requests at the proxy: $p"
# leave the app as it was: proxy off
page "window.__TAURI_INTERNALS__.invoke('set_setting', { key: 'proxy_enabled', value: 'off' })" >/dev/null || true
[ "$c" -gt 0 ] && [ "$d" -eq 0 ] && [ "$p" -gt 0 ]
