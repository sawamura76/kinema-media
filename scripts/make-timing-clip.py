#!/usr/bin/env python3
"""Made-up test film for "Fix timing": a short test-pattern clip with a text
subtitle built in, and an external .srt that is the same lines shifted.

    py scripts/make-timing-clip.py <out-dir> [shift_seconds=2.5] [minutes=12]

Writes <out-dir>/timing-clip.mkv (track 1: the built-in subtitle, true times),
<out-dir>/timing-clip.shifted.srt (every line `shift` seconds LATER than true),
and prints the expected answer: Fix timing must say about -shift s (earlier).
The lines are irregular (seeded), so only the true alignment fits. No speech
is needed: the check reads the built-in subtitle as its reference. Needs
ffmpeg on the PATH (test tooling only, never shipped).
"""
import random, subprocess, sys, pathlib

out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
shift = float(sys.argv[2]) if len(sys.argv) > 2 else 2.5
minutes = float(sys.argv[3]) if len(sys.argv) > 3 else 12
total = minutes * 60

def stamp(t):
    t = max(t, 0)
    ms = round(t * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"

rnd = random.Random(20261121)
cues, t = [], 20.0
while t < total - 20:
    d = rnd.uniform(1.2, 3.8)
    cues.append((t, t + d))
    t += d + rnd.uniform(0.6, 7.0)

def write(path, delta):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for i, (a, b) in enumerate(cues, 1):
            f.write(f"{i}\n{stamp(a + delta)} --> {stamp(b + delta)}\nLine {i} of the made-up film.\n\n")

write(out / "true.srt", 0)
write(out / "timing-clip.shifted.srt", shift)
subprocess.run([
    "ffmpeg", "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", f"testsrc2=size=320x180:rate=12:duration={total}",
    "-f", "lavfi", "-i", f"sine=frequency=440:duration={total}",
    "-i", str(out / "true.srt"),
    "-map", "0:v", "-map", "1:a", "-map", "2:s",
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "48k", "-c:s", "srt", "-metadata:s:s:0", "language=eng",
    str(out / "timing-clip.mkv"),
], check=True)
(out / "true.srt").unlink()
print(f"{len(cues)} lines; expected delay about {-shift:+.1f} s; clip {total:.0f} s")
