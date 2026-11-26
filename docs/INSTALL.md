# Installing Skrin

Back to the [README](../README.md). After installing, [Setting Skrin up](SETUP.md) covers the first run.

Everything is on the [Releases](https://github.com/basswaves/skrin/releases)
page: an installer and a ZIP for Windows, packages for Linux ([below](#linux)), and an `.apk`
for Android TV ([below](#android-tv)).

## Windows

On Windows you can use either file:

- **The installer** (`skrin-windows-x64-setup.exe`) installs Skrin
  for your own Windows account only, so it does not ask for an administrator.
  It adds a Start menu entry and a desktop shortcut, and lists Skrin in
  Settings → Apps. If Windows lacks Microsoft's WebView2 (most have it), the
  installer fetches it from Microsoft, so it needs an internet connection that
  one time; without one it stops with "Failed to install WebView2" and installs
  nothing. To remove Skrin, use Settings → Apps.
  That removes the program, the shortcuts and the "Offer Skrin as a video
  player" entries in Windows. It then asks, with a box you must tick, whether
  to delete your library and settings too; left unticked, they stay. Installing
  a newer version over it keeps everything.
- **The ZIP** needs no installing: extract it anywhere and run `skrin.exe`. It
  is a folder, and deleting the folder removes it (use Settings → Playback →
  Opening videos → Remove first if you offered Skrin as a video player).

### Windows will ask once whether to run it

The first time you open the installer or `skrin.exe`, Windows shows a blue box: **"Windows
protected your PC"**. Click **More info**, then **Run anyway**. Windows
remembers, and does not ask again.

It says that because Skrin is not *code-signed* — signed with a paid
certificate that tells Windows who made the program. That is all it means. It
is the same box for any small program from an independent developer, and it is
not a warning that something was found.

You should not have to take that on faith, so every release publishes a
checksum beside the installer and the ZIP. To check the file you downloaded is
the one that was published, run this in PowerShell in your Downloads folder and
compare the result with the one on the release page:

```powershell
Get-FileHash .\skrin-windows-x64-setup.exe -Algorithm SHA256
Get-FileHash .\skrin-windows-x64.zip -Algorithm SHA256
```

Skrin asks GitHub for the latest version number when it starts, and says in
Settings when a newer one is out. It never downloads or installs anything by
itself — you download the new installer or ZIP when you choose to.

## Linux

Since 0.8.0, each release has a `.deb`, an `.rpm` and a `.tar.gz` folder,
for x86-64 and for ARM, each with a checksum beside it. Skrin uses your
system's mpv and WebKitGTK; the packages have the package manager install
them:

```bash
sudo apt install ./skrin-linux-amd64.deb    # Ubuntu 24.04 or later, Debian 13
```

```bash
sudo dnf install --setopt=install_weak_deps=False ./skrin-linux-x86_64.rpm   # Fedora
```

The `--setopt=install_weak_deps=False` keeps Fedora from adding yt-dlp and
Python through mpv-libs' optional dependencies; Skrin never starts yt-dlp. If
you want ffmpeg for the detail page's badges, install it yourself (see [Optional extras](SETUP.md#optional-extras)).

Anything else: unpack the folder and run `./kinema`; it needs Ubuntu 24.04 or
Debian 13 or newer (or a distribution of the same age), plus the system's mpv
library (`libmpv.so.2`), WebKitGTK 4.1, GTK 3 and sound libraries; its
README.txt names the packages to install. On Ubuntu 22.04 the folder opens but
cannot play, because that release only has the older libmpv1.

Removing the Linux package leaves your library and settings, which live in
`~/.local/share/com.kinema.app` and `~/.cache/com.kinema.app`; delete those
folders if you want them gone. Updates are as on Windows: Skrin says when there
is one, and you install it when you choose.

### HDR on Linux

HDR on Linux needs three things, and Skrin says in its stats panel
(`i`) which one is missing:

- **mpv 0.40 or later** — Ubuntu 26.04, Debian 13, Fedora 43, Arch.
- **A desktop with HDR switched on**, or switched on by Skrin for the film
  (Settings → Picture & sound → Screen): GNOME 48 or later, KDE Plasma 6.4
  or later, Sway 1.12 or later; Hyprland switches it on by itself.
  Cinnamon has no HDR, so there HDR films are converted to SDR.
- **A graphics driver that offers HDR to windows.** NVIDIA: driver 595 or
  later, which supports GeForce RTX 20 and GTX 16 cards onwards; Ubuntu
  26.04 installs 580 unless you choose a newer one under Additional Drivers,
  and GTX 10 cards and older stop at 580, so they cannot show HDR on Linux.
  AMD and Intel: Mesa 25.1 or later — Ubuntu 26.04, Fedora 43 and Arch have
  it; Debian 13 has it in its backports. (Checked with an AMD card on Mesa
  26.0: HDR10 reaches the TV on KDE Plasma.)

Without the driver part the desktop shows HDR, but each film is converted to
SDR before it reaches it. On Hyprland, which switches HDR on by itself for a
full-screen HDR film, add `bitdepth, 10` to the TV's monitor rule: without
it HDR goes out at 8 bits per colour, and smooth gradients show bands.

## Android TV

Made for Android TV boxes and TVs with Android TV or Google TV; not made for
phones and tablets yet. Since 0.10.0, as an early version (beta): download
`skrin-android.apk` from the Releases page, copy it to the device (a
USB stick works) and open it from a file manager. Android asks once to allow
installs from that source, because Skrin is not from an app store. What has
been tried and what is missing is under
[Android TV (early version)](PLATFORMS.md#android-tv-early-version).

The file is signed with Skrin's own key. To check it is the one that was
published, compare the checksum beside it (`sha256sum -c`), and the certificate
that signed it, which for every Skrin release is:

```text
SHA-256  92f709adbc5b3f64a41e4b31c9c94b28514cd1e389786acd2b2d2274db4dbf67
```

A different certificate means it is not from this project. Android refuses to
update an app with one signed by another key, so a copy built elsewhere has to
be removed first.
