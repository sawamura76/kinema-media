# Kinema Media

A local media center for movies, TV, music, and game/app shortcuts. No media server is required.

Independent MIT-licensed fork of [Basswaves/Skrin](https://github.com/basswaves/skrin), originally Kinema. Original authorship and third-party notices remain in LICENSE and NOTICE.md.

## Windows portable

Extract the entire Windows release ZIP and run **kinema-media.exe**. Keep **libmpv-2.dll** and **libmpv-wrapper.dll** beside it. Create a desktop shortcut to the EXE; do not copy the EXE out of its folder.

Requires Windows 11 x64 and WebView2. Data lives in `%APPDATA%/local.brian.kinema-music`, separate from Skrin. First-run setup can be skipped for music-only use.

## Features

- Local movie/TV libraries, subtitles, watched/resume history, HDR and audio support inherited from Skrin.
- Music collections, artist/album pages, Artist / Album / Year / Genre / Song title browsing and shared collection defaults, queue and repeat.
- Auto/Manual Music Match with track comparison, MP3 tag editing, cached album/artist artwork and English biographies. Tag writes require Save.
- Full-screen music with artist/image slideshows, local muted video backgrounds, Butterchurn and spectrum analyzers.
- Movable, resizable, always-on-top music/video mini-players.
- Games/app launcher with platform groups and non-destructive box-art preview/cropping.
- PC, TV and Handheld modes. Handheld has larger controls and a saved scale slider (up to 115%) in Settings → Playback.
- Xbox/Ally D-pad/stick navigation, A to select, B to return, LB/RB to switch primary tabs and keep the highlight there. In TV/Handheld mode, highlighting a primary tab opens it without pressing A/Enter. Bumpers leave dialogs alone.
- Upstream 0.21.1 features: seek thumbnails, subtitle timing correction, translated movie/TV details, extras, theme music, offline IMDb matching, proxy controls, protected credentials and reliability fixes.

## Library backups

Settings → Advanced → Safety copies offers database backup restore. Music-only and game-only libraries are included. Database copies contain collections, music records and shortcuts; artwork and actual media are separate files. Credentials are excluded.

Settings → Library → Move to a new computer exports watched history, corrected video matches, playlists and settings. This transfer file is not a complete artwork/media archive.

Upgrade safety copies are made before schema changes. The new fork uses schema 45; do not open its upgraded database with an older fork build.

## Build

Install Node.js 20+ (22 recommended), Rust, Microsoft C++ Build Tools and the Windows SDK.

```powershell
npm ci
npm run check
cargo test --manifest-path src-tauri/Cargo.toml --lib
npx tauri-plugin-libmpv-api setup-lib
npm run app:build -- -NoShortcut
```

The portable output is `dist-app`. Supply optional service credentials locally; never commit keys, tokens or `.env.local`. You can enter your own TMDB key in Settings. Builds without SIMKL/Trakt/OpenSubtitles application credentials leave those integrations unavailable.

Windows is the tested fork target. Upstream Linux/Android code is retained but this combined fork has not been validated on that hardware. Our separate experimental Android music build is not part of this release. HDMI-CEC passthrough is not implemented.

See [integration notes](docs/UPSTREAM-MERGE.md), [upstream history](docs/HISTORY.md), LICENSE, NOTICE.md, and BUTTERCHURN-LICENSES.txt.
