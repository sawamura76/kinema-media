# Butterchurn and artist-art slideshows

Current backgrounds: Plain image, Blurred image, Butterchurn. The early drift/waves/RMS ripple prototypes are removed.

TheAudioDB gallery: downloads up to four fanart images, wide thumb and portrait, deduplicates addresses, resizes/validates local JPEGs and caches them. Existing cache entries migrate once. Plain and blurred modes crossfade every 15 seconds while playing, with cached/album-art fallback offline. Artist grid covers still come from the first album, not the online portraits.

Butterchurn 2.6.7 with fourteen presets from butterchurn-presets 2.4.7 and pinned official upstream sources (MIT); see BUTTERCHURN-LICENSES.txt. Presets are compiled to static functions to preserve the existing CSP without unsafe-eval. No preset editor, remote code or runtime downloads. Fourteen choices are available via Next preset; auto-advance at 30 seconds, two-second blending. Resolution caps at 960x540, 30fps and mesh 32x24.

Actual waveform input: Windows process loopback (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, include this process tree) captures Kinema's own output at stereo 44.1kHz/s16. A bounded 1024-frame ring returns snapshots through local Tauri IPC. Butterchurn computes frequency bands from these real samples. No mic, other apps, recordings, network audio upload, synthetic spectrum, second decoder or external executable.

Native lifecycle: COM/MF and audio clients stay on one capture thread. A non-owning PROPVARIANT keeps the borrowed activation blob from being freed. The worker stops two seconds after polling ends; WebGL/audio contexts are released on leaving the view. Pause/hidden/reduced-motion stop rendering and polling. Audio/WebGL failures reveal art and a status message, without stopping music.

Validation: native process-loopback activation/shutdown and a generated real waveform test; 14/15 music UI scenarios including all fourteen presets, pause/resume, reduced motion, art failure fallback, and slideshow crossfades; complete counts in the packaged validation report. Physical Ally frame rate/battery and audio-device checks remain to be done.

References: https://github.com/jberg/butterchurn and https://github.com/jberg/butterchurn-presets. Windows API reference implementation: https://github.com/microsoft/Windows-classic-samples/tree/main/Samples/ApplicationLoopback.

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
