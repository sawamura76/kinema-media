# Platform support

Back to the [README](../README.md). What runs where, what has been tested, and what is known not to work yet.

**Windows 11**, using the WebView2 runtime that ships with it. Nothing else to
install.

**Linux**, since 0.8.0: Ubuntu 24.04 or later, Debian 13 and Fedora through
the packages, other distributions through the folder, on x86-64 and ARM.
Skrin uses the system's own mpv and WebKitGTK. Wayland offers no way to put
Skrin's page over mpv, so on Linux mpv plays in a full-screen window of its
own and draws Skrin's controls over the video itself ([HISTORY.md](HISTORY.md), "The
Linux player"). The equipment check, sound straight to a receiver and screen
switching have been checked on a real TV and receiver with GNOME, KDE Plasma,
Sway and Hyprland, on an NVIDIA and an AMD card; screen switching on
Cinnamon has been checked against Cinnamon's own window manager on a test
screen, not yet on a real TV. Skrin is built to work the same on any
desktop and fall back safely, rather than tested on every one —
see [When something goes wrong](TROUBLESHOOTING.md).

**Android TV**, since 0.10.0, as an early version (beta): see
[Android TV (early version)](#android-tv-early-version) for what is tested and what
is missing. **macOS** is planned for later, after the Windows, Linux and
Android work in hand; a port is welcome sooner, and
[CONTRIBUTING.md](../CONTRIBUTING.md) ("More than one platform") says how the
code is arranged for one.

| | Windows 11 | Linux | Android TV (early version) |
|---|---|---|---|
| Builds and passes its tests | ✓ | ✓ | ✓ |
| Library, matching, artwork, accounts | ✓ | ✓ | ✓ |
| Playback, controls, remote keys | ✓ | ✓ | ✓ on one TV box and the emulator |
| Equipment check, sound straight to a receiver | ✓ | ✓ | by Android itself; Skrin shows what Android reports |
| Screen switching (refresh rate, resolution) | ✓ | ✓ on GNOME, Cinnamon, KDE Plasma, Sway, Hyprland and the other wlroots desktops | one switch, "Match the screen to the film" |
| HDR switched on for an HDR film | ✓ | ✓ on GNOME and KDE Plasma, by Hyprland itself, and on Sway 1.12 or later (not yet tried on a real TV); needs a driver that offers HDR ([HDR on Linux](INSTALL.md#hdr-on-linux)) | by Android itself |
| Sleep / shut down | ✓ | ✓ where the system allows it without a password (logind) | — |
| Badges on a film's page, intro detection from the audio | ✓ | ✓ | not yet |
| Blu-ray `.m2ts` files | ✓ 1080p and 4K UHD HDR; track languages where the disc's `BDMV` folder is beside the file | plays through mpv, not yet tried with a whole film | 1080p plays; 4K UHD not yet |
| Blu-ray folders (`BDMV`), disc images (`.iso`) | ✓ the main film, with chapters and track languages; no menus | ✓ through the system's mpv | not yet |
| Encrypted Blu-ray discs (AACS, BD+) | not played; Skrin says so | not played; Skrin says so | — |

## Android TV (early version)

Installed by hand ([how](INSTALL.md#android-tv)). It plays through Android's own media
player (Media3) rather than mpv, so Dolby Vision and sound passed straight to
a receiver are Android's to do; Skrin shows what Android reports and, where
sound will not open, falls back rather than not playing. The interface is
always the TV layout, and folders are chosen in Skrin's own browser. It is
made for TV devices; a phone or tablet may run it, but is not designed or
tested for.

**Tested:** one TV box and the Android TV emulator, with a remote — library,
matching, network shares, playback of HDR, Dolby Vision and 1080p `.m2ts`
files, subtitles. **Not yet tested:** other boxes, held keys on the
box and the on-screen keyboard. **Missing:** the badges on a film's page,
intro detection from the audio, and Blu-ray folders, disc images and 4K UHD
`.m2ts` files (Skrin says before Play when a file cannot be opened on the
device). Skrin is built on standard Android and Media3 APIs and falls back
safely rather than being tested on every box; a setup that misbehaves is what
the bug report form is for.

## Known limitations

- **Android TV is an early version.** See [above](#android-tv-early-version) for
  what is untested and missing. macOS is planned for later (see
  [Platform support](#platform-support)).
- **Tested on a small number of setups.** HDR passthrough, bitstreaming to a
  receiver and display switching have been confirmed on a 4K HDR TV with an AV
  receiver; TV overscan, intro detection on many different shows, and libraries
  of several hundred movies have had less exposure. The roadmap lists what is
  unverified. If something behaves strangely on your equipment, the log files
  ([When something goes wrong](TROUBLESHOOTING.md)) are the most useful thing you can send.
