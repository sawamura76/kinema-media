# Screenshots

The top of the [README](../../README.md) shows `home` full width with `detail`
and `player` side by side beneath it; `stats` sits small beside the README's
"Press `i`" point and in [What Skrin does](../FEATURES.md); `settings` is in
[Setting Skrin up](../SETUP.md). The three at the top must be wide (landscape)
so their rows line up; a tall picture there stretches its row.

`home`, `detail` and `player` were retaken in Skrin's orange look on
2026-11-15 (fullscreen PNGs at 2559 × 1599, saved here as 2000 × 1250 JPEG at
quality 86); `stats` and `settings` are older but show nothing the colour
change touched. Keep the same file names and the README needs no edit. A wide
shot of the player with the playback details panel open would let the top
become an even 2×2 grid.

| File | What it shows |
|---|---|
| `home.jpg` | The home screen — hero backdrop and the rails beneath it, with "Skrin" at the top left |
| `detail.jpg` | A 4K HDR film's detail page: badges under the buttons, scores, the cast row |
| `player.jpg` | The player controls over a paused film |
| `stats.png` | The playback details panel (`i` while watching) |
| `settings.png` | The Settings section list and search box, cut from a fullscreen shot |

Take them in fullscreen, with no viewing history, playlists or device names on
screen. Never show Settings → Library: it lists the library's folder paths.
Check the audio list in `player` too: each track's title is often the file's
release name, so the current picture has those names painted out. `stats` is
the panel cut out of a player shot. The website uses the same pictures, smaller,
as `site/img/*.webp`, and `og.jpg` (1200 × 630) is the top of `home`. The site's
`settings.webp` is a different shot: Picture & sound → Screen, beside the text
about setting the screen up. It still says "Kinema" in its text (2026-11-15):
retake it, 1200 × 843.

## Choosing the film at the top of Home

Home's top film is the day's pick, which can take months to reach a given film.
For a screenshot, name the film yourself: make a text file called
`home-top.txt` in Skrin's data folder (`%APPDATA%\com.kinema.app\` on Windows,
`~/.local/share/com.kinema.app/` on Linux; Settings → Advanced → Developer
tools → Open log folder opens the `logs` folder inside it), write the film's
name on the first line — `A Film` or, when two share a name, `A Film (2024)` —
and open Skrin. Capitals and punctuation do not matter. Delete the file
afterwards and the day's pick is back. A name that matches nothing is ignored.

Ordinary Windows capture — `Win`+`Shift`+`S` or PrintScreen — picks these up
fine, video included. If the video area comes out black, check where you are in
the file rather than assuming the capture failed: a still taken during an
opening fade is black because the frame is black.

## Keep them reasonable

Full-window, and ideally a few hundred KB each — they load on every visit to the
repository's front page. A backdrop-heavy screen makes a large PNG; JPEG at high
quality is visually identical for photographic content and a tenth of the size.

A library with a few real titles in it looks more honest than a staged one.
