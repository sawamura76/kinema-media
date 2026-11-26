# Kinema Media — Brian's personal Windows build

## Artist and album detail pages

Artist pages use Back, a large artist portrait (or first album cover), artist name, cached biography and album tiles. The root Music heading, tab/search controls and artwork-credit/refresh row are omitted on detail pages. Artist photos and English/Japanese biographies come from the existing TheAudioDB lookup; the available alternate language is used if the preferred one is missing. Unknown biographies show a short fallback message. Long biographies can expand with Read more.

Album pages use the album cover, title, artist link, tagged year/genre, track count and total duration. Existing Play / Shuffle / Queue actions and the track list remain. The artist link opens that artist's page. Back or Escape/Backspace steps from album to its artist or album grid, then back to the main artist view. Top Music always resets to the main page. Playback and the current queue continue through navigation.

## Music home navigation

Selecting Music in the top navigation always returns to the main music page on Artists, clearing an open artist, album, queue tab or search. Playback and its queue continue unchanged. The approved artist and album detail layouts are now applied; earlier HTML/image mockups are retained as references.

## Artwork downloads and playback layout fix

Settings → Library → Music folders has **Find missing album art** and **Download artist slideshow art**. Both show progress and can be cancelled after the current network request.

Missing covers are matched by tagged album artist and album title, first through TheAudioDB, then MusicBrainz / Cover Art Archive. Ambiguous matches and unknown tags are left alone. Existing valid covers are kept. Covers are cached in app data and reused on rescans; music files and their tags are not modified. Library tiles and the current playing queue pick up completed cover updates without restarting playback.

Artist slideshow downloads refresh each album artist's available TheAudioDB fanart, wide photo and portrait: up to six images per artist, depending on provider availability. Existing cached art remains available offline. Use Visualizer → Art → Artist background → Rotate to view it. Artist and album names are sent to the artwork providers; audio files and file paths are not uploaded.

Video controls are anchored to the bottom again in normal and fullscreen mode, including after restoring from the mini-player. Album covers are fully opaque over visualizations while visible; the existing idle fade remains.

## Floating mini-player

Settings → Navigation & controls has independent **Music mini-player** and **Video mini-player** On/Off switches. Both default to On. With the relevant switch enabled, minimizing active playback turns the current window into a small floating player. It is always on top, movable by its title bar or header, and resizable by its normal window edges. The picture/queue keeps playing in the same playback session.

Music shows album artwork, track/artist/album, previous/play-pause/next and volume. Video keeps its picture, with play/pause, ±10-second seeking and volume. Receiver-controlled audio keeps its existing volume behavior.

The Restore button or Escape/Back returns to the previous window layout, including fullscreen/maximized state and its previous always-on-top setting. The floating size and position are remembered for the next use during this app session. Minimize the floating window again to hide it normally. The Windows close button closes Kinema and stops playback. If music ends or playback leaves the video player, the main layout returns. Music visualizers suspend while the mini-player is in use.

Run `Start Kinema Media.cmd` for the latest local build. In a transferred portable folder, use its `Start Kinema Media.cmd`.

## Visualizer panel

Open **Visualizer** at the top right of fullscreen music. Choose **Art**, **Butterchurn** or **Spectrum analyzer** from its dropdown. The header/category stay pinned while the controls scroll, including on the Ally-sized window.

- Select a visual's name to show it immediately. Its checkmark includes/excludes it from rotation; at least one remains enabled in each category. Selecting an excluded visual includes it again.
- **Static** holds the chosen style/preset. For Art, it also holds the current slideshow image. **Rotate** cycles only enabled styles/presets; Art advances downloaded images too. Rotation stays within the selected category.
- Each category saves its own rotation choice and duration. Butterchurn defaults to 30 seconds. Spectrum defaults to Static; Art defaults to Rotate.
- Butterchurn and Spectrum each have independent **Sensitivity** (0.5× to 3×). This adjusts the measured signal sent to the graphics, without changing listening volume.
- Art contains artwork-source and image-fit controls. Cover/song details can be shown or hidden in every category.
- The right arrow closes the panel. Escape/Back closes an open dropdown first, then the panel; a further Back exits fullscreen. D-pad/keyboard navigation stays in the open panel.
- The panel fades/slides away after the same inactivity delay as the playback bar (10 seconds by default). Input during that brief fade restores it; after it closes, reopen it with Visualizer. The Always visible setting keeps it open until manually closed.

The first music version adds:

- Music beside Movies and TV, with Albums, Artists, Songs, Queue and Folders.
- Local MP3, FLAC, M4A/AAC, Ogg/Opus, WAV, AIFF, APE and WavPack scanning through Lofty (actual playback still depends on the file and codecs).
- Embedded artist/album/song tags, multidisc ordering, embedded cover art and cover.jpg/folder.jpg artwork. Missing tags fall back to readable names.
- A playback bar that remains while browsing, temporary queues, shuffle, repeat-all and repeat-one, seeking and volume.
- Standard Xbox/Ally controller navigation when this app has focus.

## Get started

Open Settings → Library → Music folders → Add music folder. Pick your music directory, then allow the scan to finish. Use Scan music now in Settings after adding or changing files. Artist grouping uses Album Artist when present, otherwise Artist; tagging compilations with the same Album Artist keeps them together.

Music opens on Artists; its tabs are Artists, Albums, Songs and Queue. Choose an album or Songs, then Play or Shuffle. `+ Queue` appends songs. The Queue page can remove songs; its Shuffle queue control shuffles only the songs still to come while playing. Queues currently last for the running session rather than being saved as named playlists.

The updated playback bar uses the video player's icons and layout: Previous track, Play/Pause, Next track. Its timeline supports clicking, pointer/touch dragging and keyboard/controller seeking. Focus the timeline and use Left/Right to choose a position; release to seek. Queue and Repeat remain at the right.

Use **English / 日本語** in Settings → Language & subtitles → Music interface language to switch the music interface and player labels. Japanese tags and filenames are preserved; search accepts half-width/full-width kana and hiragana/katakana equivalents. This language option covers Music; the upstream movie/TV/settings interface remains in English.

The fullscreen icon in the bottom player opens a music stage with album art on the left, artist/album/track details beside it, and enlarged, blurred, darkened artwork behind them. The same icon exits to browsing without stopping music; Escape/Back and the top exit button also return. The window's previous fullscreen state is restored. The top-right Visualizer button opens the category panel; details are below. Rendering and slideshows pause while hidden or paused, and reduced-motion preferences are respected.

The Windows path-prefix bug that left real music stuck on a loading dot is fixed. Play/Pause always has an icon and reads the engine's actual pause state, including after canonical `\\?\` paths are normalized by mpv.

Switching to a movie stops the music; they share one playback engine. Browsing Movies, Home or Settings leaves music playing until a video is actually opened.

## Ally controls

Use Gamepad mode with the embedded controller enabled. D-pad or left stick navigates, A selects, B goes back, X pauses/resumes, and LB/RB select the previous/next song while music is active. Menu also goes back. Touch/mouse and keyboard remain supported. Native gamepad behavior on a physical Ally still needs checking; avoid sending the same buttons twice through Steam Input or another mapper.

## Separate personal library

The app identifier is `local.brian.kinema-music`; the binary is `kinema-media.exe`. The existing Kinema library/settings are not shared. Windows keeps this build's data under `%APPDATA%\local.brian.kinema-music`. The App-Media folder is self-contained apart from Windows/WebView2, but its data is not currently portable between computers.

Movie/TV metadata from a source build requires your own free TMDB API key in Settings. Embedded music tags and artwork require no key or account. Upstream update checking is disabled by default so the personal fork does not suggest replacing itself with stock Kinema.

Media files are read without being rewritten. Removing a music folder removes its library entries, not the audio files. An offline or unreadable folder is reported without marking its whole collection missing.

## Scope of this first build

Gapless playback and bit-perfect output are not promised or validated. Online music identification, lyrics and named/saved music playlists are not included. Local covers are cached; changing only a cover.jpg beside otherwise unchanged audio is not currently detected by the incremental scan. Retagging/changing the audio file refreshes its cached metadata/artwork.

Validated: 998 frontend unit tests, TypeScript/ESLint, sixteen Chromium music UI flows, an existing video seek/navigation flow, Japanese filename/tag scanning through Lofty/SQLite, Rust tests and Clippy, and generated WAV decoding through the actual bundled libmpv. Native testing confirms mpv strips the Windows path prefix and passes two pause/resume cycles. UI checks include the fullscreen stage, cover art, continuous playback on entry/exit, and Japanese controls fitting 854×480. One existing Windows registry integration test cannot run in the restricted session and was excluded after its access-denied result. Real Ally controls and audio-device quality remain user-device checks.

## Rebuild

`Build-Personal.ps1` runs checks, builds the native Windows app and refreshes App. It uses the installed Rust MSVC/C++ tools and Node; on this PC it can fall back to Codex's bundled Node runtime. A local npm copy is provided under tools/npm. Native playback DLLs came from the official Kinema v0.15.2 Windows archive, whose published SHA-256 was verified. Their upstream license details remain in NOTICE.md.

Source base: upstream commit `999fb964e949e85cf9d29bde62275c6793dfc878`, MIT licensed. Original notices are preserved. Personal source changes are uncommitted in this checkout.

Full-screen controls retreat after 10 seconds without input. Move the mouse, press a key, or move either controller stick to bring them back. The top exit/background controls fade too. At the end of the queue, controls stay visible; Play restarts the last track. The bottom-right stop X has been removed.

## Artist artwork and audio-reactive artwork

Artist pages now use the same cover grid as Albums: each artist's first album cover, then the artist name and album count. D-pad arrows follow the grid's visible rows and columns, including after resizing.

Opening an album/artist page or full-screen music looks up that album artist in TheAudioDB using its public free API. Exact names and listed aliases are accepted; ambiguous matches are left alone. Artist photos/fanart are cached in app data and reused offline. A portrait can supply the backdrop when widescreen fanart is missing; album art is the final fallback. Choose Refresh artist art on an album/artist page to retry/update. Visualizer → Art → Artwork source switches between artist and album backgrounds. Artist names and image addresses are sent to TheAudioDB; audio files, file paths and listening history are not uploaded.

In fullscreen music, Visualizer → Art offers Plain image and Blurred image; Visualizer → Butterchurn offers the preset list. The early drift, ambient-wave and custom RMS ripple modes have been removed. Plain and blurred modes crossfade downloaded TheAudioDB artist images every 15 seconds; the slideshow pauses with music or while hidden. Existing artist caches update once to collect the gallery, with old cached images/album art as offline fallback.

Butterchurn 2.6.7 is now included, with fourteen bundled presets from butterchurn-presets 2.4.7. Next preset switches manually; automatic changes use a 30-second interval and two-second preset blend. Preset equations are compiled into static functions in the build so no runtime eval or relaxed Content Security Policy is needed. Author names and MIT notices are preserved in BUTTERCHURN-LICENSES.txt.

The Windows 11 native feed captures only Kinema's own process-tree audio through WASAPI process loopback. It never records a microphone, other applications, a file on disk, or uploads audio. Stereo 44.1kHz PCM snapshots feed Butterchurn's actual waveform/FFT input; the previous RMS filter is gone. Rendering is capped at 960×540 and 30 fps with a 32×24 mesh. Rendering/polling pause with music, hidden windows and reduced-motion preference. The native worker stops after two seconds without requests. Unsupported WebGL/audio capture falls back to artwork and leaves playback working.

Physical Ally graphics performance, battery use, output-device behavior and exclusive-audio compatibility remain device checks. Windows 11/WebView2 and working graphics/audio drivers are required. The untouched pre-visualizer and earlier Art-Visualizer ZIPs remain rollback versions.

Preset rotation can be switched between **Keep this preset** and **Rotate every 30 seconds**. Both the selected preset and this choice are saved. Manual Next preset works in either mode.

The eight requested presets appear first, followed by the original six:
- Geiss + Flexi + Martin - disconnected
- Geiss - Reaction Diffusion 2
- suksma - Hexcollie - Julian Carnival - shimmy dumb grid
- shifter - escape (sigur ros)
- Geiss - Cauldron - painterly 2 (saturation remix)
- martin - reflections on black tiles
- _Mig_085
- high-altitude basket unraveling - singh grooves nitrogen argon nz+

## Kinema Media update

### Spectrum analyzers

The top-right Visualizer button opens a right-side panel. Its category dropdown offers Art, Butterchurn and Spectrum analyzer. Settings → Visualizations can also select the saved default directly.

Radial spectrum uses rainbow bars around a ring and falling peak marks. Retro LED uses segmented green/yellow/red columns with peak indicators. Color spectrum uses blue/teal/yellow/red gradient columns on a dim spectrum grid. These are original Canvas 2D renderers; no audioMotion code or new runtime dependency is included.

All three measure Kinema's existing process-only 44.1 kHz audio capture with a Hann-windowed 1024-point FFT, 64 logarithmic bands (40 Hz–18 kHz), fixed -72..0 dBFS scaling, attack/release smoothing and peak decay. Stereo channel powers are combined to avoid phase cancellation. Low-frequency detail is limited by the 1024-sample capture window; these are listening visualizations, not precision measurement tools.

They respect Battery saver/Balanced/High quality settings, pause and window visibility, and reduced motion. Unavailable audio capture falls back to artwork without stopping music. In analyzer modes, cover/song details fade with the controls so the spectrum can fill the view; move the mouse, controller or press a key to bring them back. Set Cover and song details to Hide for an unobstructed view immediately.

### Controls/settings snapshot — before spectrum analyzers

Settings → Navigation & controls contains the saved Mouse Back / Forward switch. Extra mouse buttons navigate app history and music artist/album pages. Keyboard-style USB/Bluetooth remotes can use existing keyboard navigation; HDMI-CEC and configurable remote mapping are not implemented.

Settings → Visualizations saves slideshow duration, image crossfade and fit, default background/artwork source, preset rotation duration/blend, rendering quality, control-hide delay (including always visible), and cover/song detail visibility. Battery saver caps rendering at 640×360/24 fps; Balanced at 960×540/30 fps; High at 1280×720/60 fps. Rendering preserves aspect ratio. The visualizer panel uses these saved preferences, with independent Art and Spectrum rotation settings.

The earlier Controls ZIP is the pre-spectrum rollback snapshot. Current builds include spectrum analyzers and the visualizer panel.

The application/window/executable are now Kinema Media / kinema-media.exe. Its internal library identity and data path deliberately keep their original name, so existing music/video libraries, artwork and preferences remain available.

Music folder add/remove/rescan now live in Settings → Library → Music folders, using the existing music scanner independently of video matching. The music language control lives in Settings → Language & subtitles. The Music page has only Artists / Albums / Songs / Queue, starts on Artists, and has no Add folder, Rescan, Language or Folders toolbar controls.

Butterchurn drawing-buffer dimensions now match the render viewport and resize with the window. This fixes clipping/magnification caused by the browser's default 300x150 canvas buffer; the 960x540 rendering cap preserves the view's aspect ratio.


English artist biographies: English mode uses TheAudioDB English text, then a conservatively matched English Wikipedia summary with source and CC BY-SA credit. Japanese is no longer substituted in English mode. Existing artist metadata upgrades automatically when opened; Download artist slideshow art refreshes the library in bulk. Artists without a matching English entry remain unavailable.
