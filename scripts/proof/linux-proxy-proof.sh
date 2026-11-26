#!/usr/bin/env bash
# The proxy setting (Settings → Privacy) in the real app on a real Linux
# desktop (the Linux test PC), by SSH, silent, own data dir:
#
#   TMDB_API_KEY=<a key; any 32 hex characters also shows the requests, as refused ones> scripts/proof/linux-proxy-proof.sh <media-folder> [files=8] [secs=150]
#
# Two runs of the installed skrin as a self-test on a fresh data dir with a
# small library (hard links to <files> films of <media-folder>), one title
# scan with lookups each:
#   1. CONTROL, proxy off: the sampler (ss, every 0.3 s) must see skrin or
#      WebKit connecting straight to the internet — proof the sampler sees.
#   2. PROXY on (a logging proxy on 127.0.0.1): every lookup must be a line
#      in the proxy log, and the sampler must see NO direct connection.
# Exit 0 only when the control saw direct connections, the proxied run saw
# none, and the proxy log shows TMDB. The key goes only into the test data dir.
set -u
media=$(realpath "$1"); n=${2:-8}; secs=${3:-150}
: "${TMDB_API_KEY:?set TMDB_API_KEY (a key of your own)}"
here=$(cd "$(dirname "$0")" && pwd)
root=$HOME/kinema-test/p11; rm -rf "$root"; mkdir -p "$root"
export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus QT_QPA_PLATFORM=wayland

run() { # name proxy(0/1)
  local name=$1 proxy=$2 d=$root/$1
  mkdir -p "$d/xdg/com.kinema.app" "$d/lib"
  ls "$media" | grep -v '^Sample Reel' | head -"$n" | while read -r f; do ln "$media/$f" "$d/lib/$f"; done
  ls "$media" | grep '^Sample Reel' | head -$((n - $(ls "$d/lib" | wc -l))) | while read -r f; do ln "$media/$f" "$d/lib/$f"; done
  cat > "$d/plan.json" <<J
{"path":null,"fileId":null,"titleId":null,"openAfter":900000,"seconds":$secs,"mute":true,
 "actions":[
  {"at":1,"do":"call","fn":"setSetting","args":["tmdb_api_key","$TMDB_API_KEY"]},
  {"at":1,"do":"call","fn":"addLibraryRoot","args":["$d/lib","movies"]},
  {"at":4,"do":"call","fn":"runScanPipeline"}]}
J
  export XDG_DATA_HOME=$d/xdg KINEMA_SELFTEST=$d/plan.json
  if [ "$proxy" = 1 ]; then
    # A first start makes the data dir's database; the proxy settings go in
    # before the real run.
    cp "$d/plan.json" "$d/real.json"
    echo '{"path":null,"fileId":null,"titleId":null,"openAfter":900000,"seconds":6,"mute":true,"actions":[]}' > "$d/plan.json"
    timeout 30 skrin >/dev/null 2>&1; sleep 1
    mv "$d/real.json" "$d/plan.json"
    sqlite3 "$d/data/library.db" "insert or replace into settings(key,value) values('proxy_enabled','on'),('proxy_address','http://127.0.0.1:18081');"
    python3 "$here/proxy-log.py" 18081 "$d/proxy.log" & ppid=$!
  fi
  : > "$d/direct.log"
  ( while :; do
      ss -tnpH state established 2>/dev/null | grep -E 'skrin|WebKit|mpv' | awk '{print $4" "$5}' | sed -E 's/pid=[0-9]+,fd=[0-9]+//' \
        | grep -vE '^(127\.|\[::1\])' >> "$d/direct.log"
      sleep 0.3; done ) & spid=$!
  systemd-run --user --scope -q -p MemoryMax=2G skrin > "$d/stdout.log" 2>&1 < /dev/null &
  sleep "$((secs + 8))"
  pkill -x skrin; sleep 2; kill $spid 2>/dev/null; [ "${ppid:-}" ] && kill $ppid 2>/dev/null
  sort -u "$d/direct.log" -o "$d/direct.u"
}
run control 0
unset ppid
run proxied 1
c=$root/control; p=$root/proxied
echo "--- control (proxy off): direct connections seen by the sampler"; head -5 "$c/direct.u"
echo "--- proxied: direct connections seen"; cat "$p/direct.u"; direct=$(wc -l < "$p/direct.u")
echo "--- proxied: proxy log hosts"; awk '{print $3}' "$p/proxy.log" | sort | uniq -c | sort -rn
echo "--- proxied: log"; grep -E 'proxy:|scan' "$p"/data/logs/app.log 2>/dev/null | head -5
cd=$(wc -l < "$c/direct.u"); seen=$(grep -c themoviedb "$p/proxy.log")
echo "control direct lines: $cd | proxied direct lines: $direct | tmdb at proxy: $seen"
[ "$cd" -gt 0 ] && [ "$direct" -eq 0 ] && [ "$seen" -gt 0 ]
