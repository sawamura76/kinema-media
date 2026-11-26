#!/usr/bin/env bash
# Round-10 proof on a real Linux desktop (the Linux test PC), by SSH:
#   - seek previews by mouse (mpv's own `mouse` commands, the page sees them as
#     a mouse over the player) and pictures made while watching;
#   - Fix timing against a subtitle built into a generated film.
#
#   scripts/proof/linux-proof.sh <clip.mkv> <library-copy-source> [seconds=75]
#
# <clip.mkv> comes from scripts/make-timing-clip.py (with its .shifted.srt
# beside it). <library-copy-source> is any small library folder (library.db +
# logs/…); it is COPIED, never touched. The app is the installed skrin
# (an RPM from scripts/package-linux.sh), run in a systemd scope with its own
# data dir, never the person's settings. Pointer moves are inside the app.
# Prints the evidence lines; exit 0 only when both proofs hold.
set -u
clip=$(realpath "$1"); src=$(realpath "$2"); secs=${3:-75}
d=$HOME/kinema-test/p10/run; rm -rf "$d"; mkdir -p "$d"
cp -a --reflink=auto "$src" "$d/data"; rm -f "$d"/data/logs/*
rm -rf "$d"/data/previews
sqlite3 "$d/data/library.db" "update media_files set path='$clip', missing=0 where id=1;"
srt="${clip%.mkv}.shifted.srt"
# Mouse: on a 1920x1080 window the seek bar is at y 968, x 112..1806 (read from
# a screenshot). Each move is an mpv input command; two moves per point so the
# first one shows the bar and the second one lands on it.
moves=""
t=10
for x in 300 700 1100 1500; do for y in 960 968; do
  moves="$moves{\"at\":$t,\"do\":\"mpv\",\"args\":[\"mouse\",\"$x\",\"$y\"]},"; t=$((t+1))
done; done
cat > "$d/plan.json" <<J
{"path":"$clip","fileId":1,"titleId":null,"openAfter":3,"seconds":$secs,
 "actions":[$moves
  {"at":30,"do":"call","fn":"subTimingCheck","args":[{"video":"$clip","subtitle":"$srt","aid":1,"centre":false,"reference":1,"duration":720}]}]}
J
export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus QT_QPA_PLATFORM=wayland
export XDG_DATA_HOME=$d/xdg KINEMA_SELFTEST=$d/plan.json
mkdir -p "$XDG_DATA_HOME"
systemd-run --user --scope -q -p MemoryMax=2G skrin > "$d/stdout.log" 2>&1 < /dev/null &
sleep "$((secs + 8))"
pkill -x skrin; sleep 2
echo "--- log"
grep -E 'seek preview|subtitle timing' "$d/data/logs/app.log" | tail -20
echo "--- pictures made"
ls "$d/data/previews"/*/ 2>/dev/null | head -3; find "$d/data/previews" -name '*.jpg' 2>/dev/null | wc -l
python3 - "$d" <<'PY'
import json, sys, glob
d = sys.argv[1]
log = open(f"{d}/data/logs/app.log", errors="replace").read()
hovers = log.count("seek preview: ") - log.count("seek preview: frames dropped")
rep = None
for f in (f"{d}/report.json", *glob.glob(f"{d}/data/report.json")):
    try: rep = json.load(open(f)); break
    except Exception: pass
ok_t = False
if rep:
    for e in rep.get("timeline", []):
        if e["kind"] == "call:done" and (e.get("detail") or {}).get("fn") == "subTimingCheck":
            r = e["detail"]["result"]; print("timing:", r)
            ok_t = r.get("outcome") == "fixed" and abs(r.get("delay_secs", 0) + 2.5) < 0.1
print("hover pictures logged:", hovers, "| timing ok:", ok_t)
sys.exit(0 if hovers >= 3 and ok_t else 1)
PY
