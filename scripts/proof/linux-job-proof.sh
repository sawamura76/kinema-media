#!/usr/bin/env bash
# The whole-library preview job on a weak Linux PC (the Linux test PC: 2 cores),
# by SSH, silent:
#   scripts/proof/linux-job-proof.sh <library-copy-source> <film-path> <file-id> [job-seconds=840]
#
# Starts the installed skrin as a self-test on a COPY of the library with the
# job switched on, samples the app's CPU every 30 s, and after <job-seconds>
# plays the film (file-id) while the job is mid-file; reads mpv's dropped
# frames and `mute` 5 s and 65 s into the film. Never touches the PC's own
# settings (own data dir under ~/kinema-test/p10/job). Prints:
#   CPU % of one core per sample, "preview job: file N done in X s" lines,
#   pictures made, and the drop counts + mute from the report.
set -u
src=$(realpath "$1"); film="$2"; fid=$3; job=${4:-840}
d=$HOME/kinema-test/p10/job; rm -rf "$d"; mkdir -p "$d"
cp -a --reflink=auto "$src" "$d/data"; rm -f "$d"/data/logs/*; rm -rf "$d"/data/previews
sqlite3 "$d/data/library.db" "insert or replace into settings(key,value) values('preview_job','1');"
end=$((job + 80))
cat > "$d/plan.json" <<J
{"path":"$film","fileId":$fid,"titleId":null,"openAfter":900000,"seconds":$end,"mute":true,
 "actions":[
  {"at":$job,"do":"play"},
  {"at":$((job+5)),"do":"probe","args":["frame-drop-count","decoder-frame-drop-count","mute","time-pos"]},
  {"at":$((job+65)),"do":"probe","args":["frame-drop-count","decoder-frame-drop-count","mute","time-pos"]}]}
J
export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus QT_QPA_PLATFORM=wayland
export XDG_DATA_HOME=$d/xdg KINEMA_SELFTEST=$d/plan.json
mkdir -p "$XDG_DATA_HOME"
systemd-run --user --scope -q -p MemoryMax=2G skrin > "$d/stdout.log" 2>&1 < /dev/null &
sleep 5
pid=$(pgrep -xo skrin)
prev=$(awk '{print $14+$15}' /proc/$pid/stat); t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt $((end - 5)) ]; do
  sleep 30
  cur=$(awk '{print $14+$15}' /proc/$pid/stat 2>/dev/null) || break
  echo "t=$(( $(date +%s) - t0 ))s cpu $(( (cur - prev) * 100 / 3000 ))% of one core (last 30 s)"; prev=$cur
done
sleep 8; pkill -x skrin; sleep 2
echo "--- job log"; grep -E 'preview job' "$d/data/logs/app.log" | tail -12
echo "--- pictures"; find "$d/data/previews" -name '*.jpg' 2>/dev/null | wc -l
echo "--- report"
python3 - "$d" <<'PY'
import json, sys, glob
d = sys.argv[1]
for f in (f"{d}/report.json", *glob.glob(f"{d}/data/report.json")):
    try: r = json.load(open(f)); break
    except Exception: r = None
if not r: print("no report"); sys.exit(1)
for e in r.get("timeline", []):
    if e["kind"] == "probed": print(e["t"], e["kind"], e.get("detail"))
PY
