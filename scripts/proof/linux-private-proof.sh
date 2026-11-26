#!/usr/bin/env bash
# "Keep everything on this computer" in a NORMAL run (not a self-test) on the
# Linux test PC, by SSH: with the mode on and a library folder present, the
# check for new versions (and everything else) must not leave. A logging
# proxy (Settings → Privacy's own setting) sees every request.
#
#   scripts/proof/linux-private-proof.sh <media-folder> [secs=45]
#
#   control  mode off, folder present, proxy on  → the proxy must see github.com
#   private  mode on  (keep_on_device=1, IMDb switches off), same → nothing at all
# Own data dir (XDG_DATA_HOME under ~/kinema-test/p11p); never the PC's settings.
# Exit 0 only when the control saw GitHub and the private run saw nothing.
set -u
media=$(realpath "$1"); secs=${2:-45}
here=$(cd "$(dirname "$0")" && pwd)
root=$HOME/kinema-test/p11p; rm -rf "$root"; mkdir -p "$root"
export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus QT_QPA_PLATFORM=wayland
unset KINEMA_SELFTEST
run() { # name private(0/1)
  local name=$1 priv=$2 d=$root/$1
  mkdir -p "$d/xdg" "$d/lib"; ln "$media/$(ls "$media" | head -1)" "$d/lib/Proof Film (2001).mkv"
  export XDG_DATA_HOME=$d/xdg
  timeout 20 skrin >/dev/null 2>&1; sleep 1; pkill -x skrin; sleep 1   # first start makes the database
  db=$(find "$d/xdg" -name library.db | head -1)
  sqlite3 "$db" "insert into library_roots(path,kind,added_at) values('$d/lib','movies',strftime('%s','now'));
    insert or replace into settings(key,value) values('proxy_enabled','on'),('proxy_address','http://127.0.0.1:18082'),('first_run_done','1');"
  [ "$priv" = 1 ] && sqlite3 "$db" "insert or replace into settings(key,value) values('keep_on_device','1'),('imdb_ratings_allowed','0');"
  python3 "$here/proxy-log.py" 18082 "$d/proxy.log" & local ppid=$!
  systemd-run --user --scope -q -p MemoryMax=2G skrin > "$d/stdout.log" 2>&1 < /dev/null &
  sleep "$secs"; pkill -x skrin; sleep 2; kill $ppid 2>/dev/null
  echo "--- $name: proxy log ($(wc -l < "$d/proxy.log") lines)"; awk '{print $3}' "$d/proxy.log" | sort | uniq -c
  grep -hE 'proxy:|keep|update' "$(find "$d/xdg" -name app.log | head -1)" 2>/dev/null | head -4
}
run control 0
run private 1
g=$(grep -c github "$root/control/proxy.log"); n=$(wc -l < "$root/private/proxy.log")
echo "control github requests: $g | private run requests: $n"
[ "$g" -gt 0 ] && [ "$n" -eq 0 ]
