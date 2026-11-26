# Kinema Media 0.22.0

Original base: 999fb96 (Kinema 0.15.2 plus unreleased work). Preserved personal music/collections/launcher snapshot, then merged upstream 3064969 (Skrin 0.21.1). Original history and attribution remain intact.

Custom Music, Collections, Games, mini-player and interface behavior is retained. Playback combines upstream seeking/double-click fixes with floating-player behavior. App identity and Windows file associations stay separate. Updates point only to sawamura76/kinema-media. Upstream release workflows are retained disabled as references; the fork publishes a Windows portable build.

Schema numbers diverged: fork 40–43 contain music/collections/games; upstream 40–41 contain video metadata. Our 44–45 add the upstream fields. Recognized upstream 40/41 layouts gain the music schema without duplicating existing video fields. Native tests cover both upgrade paths and repeated opening.

Additional changes: 20px base handheld UI with 85–150% adjustment; saved scale; LB/RB primary navigation; bounded native box-art cropping; immutable image previews; privacy/proxy gates for music lookups; music/game-only automatic backups; corrected collection membership when changing folder type.

The pre-merge source and EXE backup is local in Backups/2026-11-25-Before-Upstream-Merge. User data, artwork, keys and build output are not published.

Latest-build hardware testing on the Ally is pending. Browser tests use mocks; native tests exercise database, credential, crop and playback helpers. They do not certify every GPU, TV, AVR or Android device.

## 0.22.1 correction

Restored Kinema Media names, original Kinema K icons and red accent throughout the app. TV/Handheld primary navigation tabs now activate on controller/keyboard highlight. Bumpers switch tabs and retain menu focus without a deferred callback overriding subsequent input. PC arrows still require Enter. Upload remains on hold while these corrections are tested.
