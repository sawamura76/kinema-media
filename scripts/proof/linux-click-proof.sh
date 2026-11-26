#!/usr/bin/env bash
# GitHub #24 on a real Linux desktop (the Linux test PC), by SSH, silent, own
# data dir: the click path on mpv's own window, with mpv's `mouse` commands
# (never the person's pointer). The page hears them as real clicks
# (pageMouse.ts), so a single click, a double click and the pause that must
# not come are all the real thing.
#
#   scripts/proof/linux-click-proof.sh <film.mkv> [seconds=40]
#
# Sequence (mpv `pause` and `fullscreen` read back after each):
#   single click   -> still playing 0.1 s later, paused once 250 ms have passed
#   single click   -> playing again
#   double click   -> still playing at +0.15 s and +1 s, full screen on
#   double click   -> still playing, full screen off
# Exit 0 only when every read is as listed.
set -u
film=$(realpath "$1"); secs=${2:-40}
d=$HOME/kinema-test/p11/click; rm -rf "$d"; mkdir -p "$d/xdg"
click() { # time  -> down at t, up at t+0.04
  printf '{"at":%s,"do":"mpv","args":["keydown","MBTN_LEFT"]},{"at":%s,"do":"mpv","args":["keyup","MBTN_LEFT"]},' "$1" "$(python3 -c "print($1+0.04)")"
}
probe() { printf '{"at":%s,"do":"probe","args":["pause","fullscreen","time-pos"]},' "$1"; }
acts='{"at":6,"do":"mpv","args":["mouse","400","300"]},{"at":6.5,"do":"mpv","args":["mouse","410","310"]},'
acts+=$(click 8); acts+=$(probe 8.1); acts+=$(probe 9)            # paused at 9
acts+=$(click 10); acts+=$(probe 10.1); acts+=$(probe 11)         # playing at 11
acts+=$(click 12); acts+=$(click 12.12)   # double click: full screen toggles, pause never comes
for i in $(seq 0 30); do acts+=$(probe "$(python3 -c "print(11.9+$i*0.05)")"); done
acts+=$(click 15); acts+=$(click 15.12)   # and the other way
for i in $(seq 0 30); do acts+=$(probe "$(python3 -c "print(14.9+$i*0.05)")"); done
acts=${acts%,}
echo "{\"path\":\"$film\",\"fileId\":null,\"titleId\":null,\"openAfter\":3,\"seconds\":$secs,\"mute\":true,\"actions\":[$acts]}" > "$d/plan.json"
export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus QT_QPA_PLATFORM=wayland
export XDG_DATA_HOME=$d/xdg KINEMA_SELFTEST=$d/plan.json
systemd-run --user --scope -q -p MemoryMax=2G skrin > "$d/stdout.log" 2>&1 < /dev/null &
sleep "$((secs + 8))"; pkill -x skrin; sleep 2
python3 - "$d" <<'PY'
import json, sys
d = sys.argv[1]
r = json.load(open(f"{d}/report.json"))
p = [(round(e["t"], 2), e["detail"]) for e in r["timeline"] if e["kind"] == "probed"]
by = lambda lo, hi: [v for t, v in p if lo <= t < hi]
one = p[:4]   # single clicks: 8.1 playing, 9 paused, 10.1 still paused, 11 playing
single = [v["pause"] for t, v in one]
d1 = [v for t, v in p[4:35]]; d2 = [v for t, v in p[35:66]]
print("single clicks (pause):", single, "| dense samples around double click 1/2:", len(d1), len(d2))
ok = single == ["no", "yes", "yes", "no"] and len(d1) == 31 and len(d2) == 31
ok &= all(v["pause"] == "no" for v in d1 + d2)           # never paused through either double click
fs = lambda v: v["fullscreen"]
ok &= fs(one[3][1]) != fs(d1[-1]) and fs(d1[-1]) != fs(d2[-1])   # each double click toggled full screen
print("full screen before / after double 1 / after double 2:", fs(one[3][1]), fs(d1[-1]), fs(d2[-1]))
print("click path ok:", ok)
sys.exit(0 if ok else 1)
PY
