# Setting Skrin up

Back to the [README](../README.md). The first run, the optional extras, and how Skrin reads file names.

## First run

The app opens on a welcome panel that asks two things, each answered in a
press:

- **Where you will watch** — a TV from the sofa gives big text and the whole
  screen, made for a remote; a desk gives a window.
- **Where your videos are.** Point it at where you keep your movies, and
  another at your TV shows if they live somewhere else. Local drives and
  network shares both work. Nothing is moved, renamed or written to — the
  files are only read. The one exception is an optional export of .nfo files
  that you have to press yourself.

On Android there is no system folder picker on a TV, so Skrin shows its own:
the device's storage, a USB drive, or a network drive (a NAS or a computer's
shared folder, which it signs in to itself). The first time, Android asks to
let Skrin read the files.

Then press **Scan my library**. The first scan takes a few minutes on a large
library, and while it runs Skrin asks the rest on a few short pages, each
one skippable, with **Finish later** to go straight to the library:

- **Picture and sound:** sound straight to a receiver, the screen matched to
  the film, HDR switched on for HDR films — each with what it gives and what
  it costs, for every device that can, only the ones connected now, or off.
  Skipped, everything stays off.
- **Skipping intros:** skip them, or show a Skip button; and whether to
  ask TheIntroDB and IntroDB, which know them from other viewers.
- **Keep track of what you watch:** SIMKL or Trakt, to keep a record of what
  you finish.
- **Subtitles online:** an OpenSubtitles account, for more a day.
- **Details and ratings:** [ffmpeg](https://ffmpeg.org), which Skrin uses for intros,
  credits and a title's picture and sound details but does not include — on
  Windows one press installs it for you — and an OMDb key for Rotten Tomatoes
  scores.

Everything on them is in Settings too — grouped the same way, by what you
want rather than by service, with a search box at the top of the list — and
Settings → Library → **Run setup again** brings the pages back. After the first scan, Skrin scans once at
every start and only looks at what changed.

<img src="images/settings.png" width="240" alt="The Settings list: a search box above nine sections named by what you want, from Library and Playback to Privacy and Advanced">

Posters, descriptions and artwork come from [TMDB](https://www.themoviedb.org),
through a key Skrin carries — there is nothing to sign up for. If you would
rather use a free TMDB key of your own, paste it in Settings → Posters & ratings. Should
TMDB ever be out of reach, movies are still identified through Wikidata, just
without pictures.

Press **?** at any time — or the **?** button in the top bar — for the full list
of keys and remote buttons.

## Optional extras

None of these are bundled, downloaded or required. Each one adds a feature, and
without it that feature is skipped and everything else carries on. (On Windows,
ffmpeg is the one Skrin can install for you, with a button — see below.)

| | What it adds | Without it |
|---|---|---|
| **[ffmpeg](https://ffmpeg.org/download.html)** | Skrin's own intro and credits detection, by fingerprinting a season's audio; and the picture and sound badges on a title's page — resolution, Dolby Vision, HDR, Atmos, the measured aspect ratio | Intros and credits come from TheIntroDB and chapter markers only; a title's page keeps its source, studio, age rating and scores, without the picture and sound badges |
| **[Skiptro](https://github.com/MikeSiLVO/skiptro-releases)** | A second, well-tuned intro detector that Skrin can run and read | The built-in detector handles it |
| **An [OMDb key](https://www.omdbapi.com/apikey.aspx)** (free) | Rotten Tomatoes scores on a title's page, in Settings → Posters & ratings. Skrin spends at most half of a free key's daily lookups | IMDb's and TMDB's scores only |

These two are for Windows and Linux; Android has no way to run them, and its
intro skips come from the two community databases below.

**ffmpeg on Windows:** press **Install ffmpeg** — on the first run's Details and
ratings page, Home's ffmpeg notice, or Settings → Skipping intros. Skrin asks Windows'
own app installer, winget, to install the Windows build from
[gyan.dev](https://www.gyan.dev/ffmpeg/builds/) that ffmpeg's site points to
(about 110 MB), for your user only, with no administrator prompt. Skrin finds
it straight away and reads your files with it in the background. It is then a
program of its own: it stays if Skrin is removed, and `winget uninstall
Gyan.FFmpeg.Essentials` removes it. A Windows without winget gets the download
page instead.

**Installing Skrin with winget** (`winget install Basswaves.Skrin`) installs
the same ffmpeg first, because the winget package lists it as a dependency; you
do not need to press the button then. Uninstalling Skrin leaves it, as above.
The installer from this page does not install ffmpeg until you press the button.

Elsewhere — or to use a copy you already have — put ffmpeg on your `PATH`, or
point Settings at it. On Linux the `.deb` and `.rpm` packages recommend it.
Fedora's own `ffmpeg-free` leaves out HEVC and E-AC-3; Skrin says in Settings
what that costs, and RPM Fusion's full `ffmpeg` has them.

Skiptro is configured the same way as a copy of ffmpeg you have, at whatever
path you installed it to — point Skrin at `skiptro.exe`,
the command-line one, not `Skiptro-Desktop.exe`.

**TheIntroDB** and **IntroDB** are on by default and need nothing installed.
They are two separate collections of intro, recap and credits times that viewers
have shared, looked up one episode or film at a time, when you play it. IntroDB
also knows where some films have a scene after the credits, so Skip can take
you straight to it. Only which film or episode it is gets sent — no account, no
key, nothing about you. Turn either off in Settings if you would rather it did
not.

**SIMKL** is off until you connect it, in Settings → Keep track of what I watch. Skrin then adds
each film and episode you finish to your SIMKL account — and, once, everything
you had already watched in Skrin. It only ever adds: nothing comes back, and
marking something unwatched in Skrin leaves SIMKL alone. You approve Skrin on
SIMKL's own page, so Skrin never sees your password.

**OpenSubtitles** needs nothing to start: "Find subtitles online" in the
player's Audio & subtitles panel allows 5 downloads a day, or 20 with a free
OpenSubtitles account, signed in under Settings → Language & subtitles. What is found is
kept in Skrin's own folder, never beside your videos. The same section can
also have Skrin fetch forced subtitles by itself for files without them.

**Trakt** works the same way, beside SIMKL in Settings → Keep track of what I watch, with one
difference: Trakt keeps every play it is sent, so when you connect Skrin first
asks what your Trakt account already has and sends only the rest. A free Trakt
account can be connected to only one app besides Trakt's own. Trakt also gives
back where you stopped a film or episode, so it continues on your other
devices; the newer position wins. Trakt's card there, "Continue where
you stopped on another device", turns that off. SIMKL is only ever sent to.

**Your sign-ins and keys** (SIMKL, Trakt, OpenSubtitles, and any TMDB or OMDb key you typed in) are kept sealed on Windows and Android, so the library file alone does not give them away, and the weekly safety copies leave them out. On Linux the Skrin folder is readable only by you. Restoring a safety copy means connecting SIMKL and Trakt and typing the keys again.

## How Skrin reads file names

Skrin works out what a file is from its folder and file name. Two layouts
always work:

- Films: `Title (Year)/Title (Year).mkv`
- Episodes: `Show/Season 01/Show S01E01.mkv`

Release-style names with dots and tags (`Title.2019.1080p.BluRay-GRP.mkv`)
are fine too, and a folder with the title can carry a file with only tags.
An NFO file beside the video, holding a TMDB or IMDb number, settles the match.

Skrin only accepts a match it is sure of. A file it would be guessing at goes
to Settings → Library → Needs attention, where you search and link the right
title, keep it under its own name, or ignore it. The full guide is at
<https://skrin.org/file-names.html>.
