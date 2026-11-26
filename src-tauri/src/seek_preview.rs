//! Seek preview pictures (AFTER-0.10.0 "Seek preview pictures", round 10): a
//! small picture above the seek bar of where the bar points — the mouse over
//! it, a drag, or Left/Right held on a keyboard or a remote.
//!
//! One picture every [`STEP_SECS`] of the film, ~320 px wide JPEGs of about
//! 10 KB, kept in `<app data>/previews/<file id>/<second>.jpg` — never beside
//! the video — for as long as the file is in the library ([`sweep`] removes a
//! file's folder once its row is gone or names another file). Settings →
//! Advanced → Storage shows the space and deletes them.
//!
//! Made by a second libmpv handle, as a Videos tile's frame is (videos.rs),
//! but kept open for the film being watched: paused, `vo=null`, software
//! decoding on two threads, a keyframe seek and `screenshot-to-file`. Measured
//! over a network share on 2026-11-21: open ~300 ms, then 50–100 ms a picture
//! for 1080p and ~200 ms for 4K HDR. mpv's screenshot tone-maps HDR to SDR
//! itself, so an HDR film's pictures are not washed out.
//!
//! Two kinds of request, one worker thread:
//! - **live**: the bar's point. Only the newest waiting request is answered
//!   with a picture; older ones are answered with none at once.
//! - **filling in while watching**: when the page says so (after the film has
//!   started, never while frames drop — `useSeekPreview.ts`), one missing
//!   picture every [`FILL_GAP`], from the play head on, at low priority. A
//!   live request always goes first.
//!
//! Android (round 11, A1) has no mpv: the same worker asks `PreviewPlugin.kt`,
//! which decodes the keyframe with a software decoder (never the film's own)
//! and converts HDR itself. A box has little room, so there the pictures are
//! kept within a cap ([`cap`]): other files' oldest pictures go first, and a
//! film larger than the cap alone keeps no more. Filling in while watching
//! runs there too (`useSeekPreviewFill`, Media3's dropped frames); a film on a
//! network share gets live pictures only, so the share's bandwidth stays the
//! film's. The whole-library job is the desktop's (`preview_job.rs`).

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::library::Db;
use crate::util::to_string_err;

/// Seconds between two pictures; a request is answered with the nearest one.
pub const STEP_SECS: u32 = 10;

/// The folder in app data that holds every file's pictures.
pub fn folder_in(data_dir: &Path) -> PathBuf {
    data_dir.join("previews")
}

fn folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(folder_in(&crate::data_dir(app)?))
}

pub(crate) fn file_folder(root: &Path, file_id: i64) -> PathBuf {
    root.join(file_id.to_string())
}

pub(crate) fn picture(root: &Path, file_id: i64, at: u32) -> PathBuf {
    file_folder(root, file_id).join(format!("{at}.jpg"))
}

/// The second a request at `secs` is answered with: the nearest step.
pub fn step_for(secs: f64) -> u32 {
    if !secs.is_finite() || secs <= 0.0 {
        return 0;
    }
    let steps = (secs / f64::from(STEP_SECS)).round();
    // A film is far shorter than u32::MAX seconds.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let at = steps as u32 * STEP_SECS;
    at
}

/// What a file's folder was made from, so a file id used again by a different
/// file (or the file replaced in place) never shows the old one's pictures.
pub(crate) const SOURCE: &str = "source";

pub(crate) fn source_of(path: &str, size: i64) -> String {
    format!("{path}\n{size}")
}

/// The path and size of a file in the library, if it is in it.
pub(crate) fn file_row(conn: &Connection, file_id: i64) -> Result<Option<(String, i64)>, String> {
    conn.query_row(
        "SELECT path, COALESCE(size_bytes, 0) FROM media_files WHERE id = ?1",
        params![file_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .map_err(to_string_err)
}

/// Make a file's folder ready: emptied first when it was made from another file.
#[cfg_attr(target_os = "ios", allow(dead_code))]
pub(crate) fn prepare(root: &Path, file_id: i64, path: &str, size: i64) -> std::io::Result<()> {
    let dir = file_folder(root, file_id);
    let source = source_of(path, size);
    let stored = std::fs::read_to_string(dir.join(SOURCE)).ok();
    if stored.as_deref() != Some(source.as_str()) {
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(SOURCE), source)?;
    }
    Ok(())
}

/// Remove the pictures of every file that has left the library, or whose id
/// now names another file. A file only missing for now (a drive unplugged, a
/// share asleep) keeps its row, and its pictures. Returns the folders removed.
pub fn sweep(conn: &Connection, root: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(root) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let dir = entry.path();
        let keep = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<i64>().ok())
            .and_then(|id| file_row(conn, id).ok().flatten())
            .is_some_and(|(path, size)| {
                std::fs::read_to_string(dir.join(SOURCE)).ok() == Some(source_of(&path, size))
            });
        if !keep && std::fs::remove_dir_all(&dir).is_ok() {
            removed += 1;
        }
    }
    if removed > 0 {
        crate::log!("seek previews: removed the pictures of {removed} file(s) no longer in the library");
    }
    removed
}

/// Sweep on a thread of its own: at start-up, and after a folder leaves the library.
pub fn sweep_soon(app: &tauri::AppHandle) {
    use tauri::Manager;
    let app = app.clone();
    std::thread::spawn(move || {
        let _low = crate::jobs::background();
        let Ok(root) = folder(&app) else { return };
        if !root.exists() {
            return;
        }
        let db = app.state::<Db>();
        let Ok(conn) = db.0.lock() else { return };
        sweep(&conn, &root);
    });
}

#[derive(serde::Serialize, Default, Debug, PartialEq, Eq)]
pub struct Usage {
    pub files: u64,
    pub bytes: u64,
    /// The most they may take here ([`cap`]), or none: kept until the file leaves.
    pub limit: Option<u64>,
}

/// The most space a device's pictures may take, however much room it has.
pub const CAP_MAX: u64 = 256 * 1024 * 1024;

/// A tenth of `room` (free space plus what the pictures take now), at most
/// [`CAP_MAX`]: what the device reports, never a test box's size.
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
pub fn cap_for(room: u64) -> u64 {
    (room / 10).min(CAP_MAX)
}

/// The most space the pictures may take on this device, or none (computers:
/// they stay until their file leaves the library, as before).
pub fn cap(root: &Path) -> Option<u64> {
    #[cfg(target_os = "android")]
    {
        free_space(root).map(|free| cap_for(free + usage_in(root).bytes))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = root;
        None
    }
}

/// Free space where the pictures are kept, as the system reports it.
#[cfg(target_os = "android")]
fn free_space(root: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let mut at = root;
    while !at.exists() {
        at = at.parent()?;
    }
    let path = std::ffi::CString::new(at.as_os_str().as_bytes()).ok()?;
    // SAFETY: statvfs reads a C string and fills the struct it is given.
    unsafe {
        let mut stat: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(path.as_ptr(), &mut stat) != 0 {
            return None;
        }
        #[allow(clippy::unnecessary_cast, clippy::useless_conversion)]
        Some(u64::from(stat.f_bavail) * u64::from(stat.f_frsize))
    }
}

/// Make room under `limit`: other files' folders go, the least recently added
/// to first; `keep` (the film being watched) stays. Returns the bytes left.
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
pub fn trim(root: &Path, keep: i64, limit: u64) -> u64 {
    let Ok(dirs) = std::fs::read_dir(root) else { return 0 };
    let keep = keep.to_string();
    let mut folders: Vec<(std::time::SystemTime, PathBuf, u64)> = Vec::new();
    let mut total = 0;
    for dir in dirs.flatten() {
        let path = dir.path();
        let Ok(files) = std::fs::read_dir(&path) else { continue };
        let mut bytes = 0;
        let mut newest = std::time::SystemTime::UNIX_EPOCH;
        for file in files.flatten() {
            if file.path().extension().is_some_and(|e| e == "jpg") {
                if let Ok(meta) = file.metadata() {
                    bytes += meta.len();
                    newest = newest.max(meta.modified().unwrap_or(newest));
                }
            }
        }
        total += bytes;
        if path.file_name().and_then(|n| n.to_str()) != Some(keep.as_str()) {
            folders.push((newest, path, bytes));
        }
    }
    folders.sort_by_key(|(time, _, _)| *time);
    let mut removed = 0;
    for (_, path, bytes) in folders {
        if total <= limit {
            break;
        }
        if std::fs::remove_dir_all(&path).is_ok() {
            total -= bytes;
            removed += 1;
        }
    }
    if removed > 0 {
        crate::log!("seek previews: made room, the pictures of {removed} other file(s) removed");
    }
    total
}

pub fn usage_in(root: &Path) -> Usage {
    let mut usage = Usage::default();
    let Ok(dirs) = std::fs::read_dir(root) else { return usage };
    for dir in dirs.flatten() {
        let Ok(files) = std::fs::read_dir(dir.path()) else { continue };
        for file in files.flatten() {
            if file.path().extension().is_some_and(|e| e == "jpg") {
                usage.files += 1;
                usage.bytes += file.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    usage
}

/// Settings → Advanced → Storage: how many pictures, and the space they take.
#[tauri::command]
pub async fn seek_preview_usage(app: tauri::AppHandle) -> Result<Usage, String> {
    let root = folder(&app)?;
    crate::jobs::off_main(move || Ok(Usage { limit: cap(&root), ..usage_in(&root) })).await
}

/// Settings → Advanced → Storage → Delete: every picture, for every file. The
/// film being watched, if any, starts filling in again from nothing.
#[tauri::command]
pub async fn delete_seek_previews(app: tauri::AppHandle) -> Result<u64, String> {
    let root = folder(&app)?;
    worker::stop();
    // The whole-library job would make them all again at once: it goes off.
    crate::preview_job::disable(&app);
    crate::jobs::off_main(move || {
        let files = usage_in(&root).files;
        if root.exists() {
            std::fs::remove_dir_all(&root).map_err(to_string_err)?;
        }
        Ok(files)
    })
    .await
}

/// The picture for `secs` into the file, as JPEG bytes — or no bytes where
/// none can be made (Android, a file mpv cannot open, a newer request came).
#[tauri::command]
pub async fn seek_preview(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    file_id: i64,
    secs: f64,
) -> Result<tauri::ipc::Response, String> {
    let root = folder(&app)?;
    let at = step_for(secs);
    let kept = picture(&root, file_id, at);
    // Already made: no worker, no waiting.
    if let Ok(bytes) = std::fs::read(&kept) {
        return Ok(tauri::ipc::Response::new(bytes));
    }
    let Some((path, size)) = ({
        let conn = db.0.lock().map_err(to_string_err)?;
        file_row(&conn, file_id)?
    }) else {
        return Ok(tauri::ipc::Response::new(Vec::new()));
    };
    let bytes = worker::live(root, file_id, path, size, at).await;
    Ok(tauri::ipc::Response::new(bytes.unwrap_or_default()))
}

/// Filling in while watching: on, from `from_secs`, or off (frames dropping,
/// the film paused for good). Off is also where it starts.
#[tauri::command]
pub async fn seek_preview_fill(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    file_id: i64,
    on: bool,
    from_secs: f64,
) -> Result<(), String> {
    if !on {
        worker::fill(file_id, None);
        return Ok(());
    }
    let root = folder(&app)?;
    let Some((path, size)) = ({
        let conn = db.0.lock().map_err(to_string_err)?;
        file_row(&conn, file_id)?
    }) else {
        return Ok(());
    };
    // Android: a film on a share keeps the share's bandwidth to itself.
    if cfg!(target_os = "android") && crate::netshare::is_share_path(&path) {
        return Ok(());
    }
    worker::start(root, file_id, path, size);
    worker::fill(file_id, Some(step_for(from_secs)));
    Ok(())
}

/// The player has closed: the second handle goes, and its memory with it.
#[tauri::command]
pub fn seek_preview_close() {
    worker::stop();
}

#[cfg(not(target_os = "ios"))]
mod worker {
    use super::{picture, prepare, Frames, STEP_SECS};
    use std::path::PathBuf;
    use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    /// The gap between two pictures filled in while watching.
    const FILL_GAP: Duration = Duration::from_millis(1200);
    /// A live request not answered by then is answered with none.
    const LIVE_WAIT: Duration = Duration::from_secs(8);

    enum Msg {
        Live { at: u32, reply: tokio::sync::oneshot::Sender<Option<Vec<u8>>> },
        Fill(Option<u32>),
        Stop,
    }

    struct Running {
        file_id: i64,
        /// Which worker this is, so one that ends never forgets its successor.
        id: u64,
        tx: Sender<Msg>,
    }

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    static RUNNING: Mutex<Option<Running>> = Mutex::new(None);

    /// The worker for this file, started if another file's (or none) runs.
    pub fn start(root: PathBuf, file_id: i64, path: String, size: i64) {
        let _ = sender(root, file_id, path, size);
    }

    fn sender(root: PathBuf, file_id: i64, path: String, size: i64) -> Option<Sender<Msg>> {
        let mut running = RUNNING.lock().ok()?;
        if let Some(r) = running.as_ref() {
            if r.file_id == file_id {
                return Some(r.tx.clone());
            }
            let _ = r.tx.send(Msg::Stop);
        }
        let (tx, rx) = channel();
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let spawned = std::thread::Builder::new()
            .name("kinema-seek-preview".into())
            .spawn(move || run(&root, file_id, &path, size, &rx, id));
        if spawned.is_err() {
            *running = None;
            return None;
        }
        *running = Some(Running { file_id, id, tx: tx.clone() });
        Some(tx)
    }

    pub async fn live(root: PathBuf, file_id: i64, path: String, size: i64, at: u32) -> Option<Vec<u8>> {
        let tx = sender(root, file_id, path, size)?;
        let (reply, answer) = tokio::sync::oneshot::channel();
        tx.send(Msg::Live { at, reply }).ok()?;
        tokio::time::timeout(LIVE_WAIT, answer).await.ok()?.ok()?
    }

    pub fn fill(file_id: i64, from: Option<u32>) {
        if let Ok(running) = RUNNING.lock() {
            if let Some(r) = running.as_ref().filter(|r| r.file_id == file_id) {
                let _ = r.tx.send(Msg::Fill(from));
            }
        }
    }

    pub fn stop() {
        if let Ok(mut running) = RUNNING.lock() {
            if let Some(r) = running.take() {
                let _ = r.tx.send(Msg::Stop);
            }
        }
    }

    fn run(root: &std::path::Path, file_id: i64, path: &str, size: i64, rx: &Receiver<Msg>, id: u64) {
        let _low = crate::jobs::background();
        let started = Instant::now();
        let handle = prepare(root, file_id, path, size)
            .ok()
            .and_then(|()| Frames::open(path));
        let Some(mut handle) = handle else {
            crate::log!("seek previews: could not open the file for pictures");
            // Answer what came, and anything else, with none until stopped.
            while let Ok(msg) = rx.recv() {
                if matches!(msg, Msg::Stop) {
                    break;
                }
            }
            forget(id);
            return;
        };
        crate::log!("seek previews: file open in {} ms", started.elapsed().as_millis());
        let duration = handle.duration();
        let mut room = Room::new(root);
        let cores = std::thread::available_parallelism().map_or(2, std::num::NonZeroUsize::get);
        let mut filling: Option<u32> = None;
        let mut next_fill = Instant::now();
        loop {
            let wait = match filling {
                Some(_) => next_fill.saturating_duration_since(Instant::now()),
                None => Duration::from_secs(3600),
            };
            let first = match rx.recv_timeout(wait) {
                Ok(msg) => Some(msg),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => break,
            };
            // Everything waiting, at once: only the newest live request counts.
            let mut newest: Option<(u32, tokio::sync::oneshot::Sender<Option<Vec<u8>>>)> = None;
            let mut stop = false;
            for msg in first.into_iter().chain(std::iter::from_fn(|| rx.try_recv().ok())) {
                match msg {
                    Msg::Live { at, reply } => {
                        if let Some((_, older)) = newest.replace((at, reply)) {
                            let _ = older.send(None);
                        }
                    }
                    Msg::Fill(from) => {
                        filling = from;
                        next_fill = Instant::now() + FILL_GAP;
                    }
                    Msg::Stop => stop = true,
                }
            }
            if stop {
                if let Some((_, reply)) = newest {
                    let _ = reply.send(None);
                }
                break;
            }
            if let Some((at, reply)) = newest {
                let asked = Instant::now();
                let bytes = take(&mut handle, root, file_id, at, &mut room);
                crate::log!(
                    "seek previews: live picture at {at} s in {} ms{}",
                    asked.elapsed().as_millis(),
                    if bytes.is_some() { "" } else { ", none made" }
                );
                let _ = reply.send(bytes);
                continue;
            }
            if let Some(from) = filling {
                if Instant::now() < next_fill {
                    continue;
                }
                let mut rest = FILL_GAP;
                match next_missing(root, file_id, from, duration) {
                    Some(_) if room.full => {
                        crate::log!("seek previews: this film alone fills the space for pictures; filling in stops");
                        filling = None;
                    }
                    Some(at) => {
                        let took = Instant::now();
                        let _ = take(&mut handle, root, file_id, at, &mut room);
                        filling = Some(at + STEP_SECS);
                        rest = rest.max(super::fill_rest(took.elapsed(), cores));
                    }
                    None => {
                        crate::log!("seek previews: every picture of this file is made");
                        filling = None;
                    }
                }
                next_fill = Instant::now() + rest;
            }
        }
        drop(handle);
        forget(id);
    }

    /// The worker that ended is forgotten, unless another has taken its place.
    fn forget(id: u64) {
        if let Ok(mut running) = RUNNING.lock() {
            if running.as_ref().is_some_and(|r| r.id == id) {
                *running = None;
            }
        }
    }

    /// The first step from `from` on without a picture, then from the start.
    fn next_missing(root: &std::path::Path, file_id: i64, from: u32, duration: Option<f64>) -> Option<u32> {
        let duration = duration?;
        let last = super::step_for(duration.max(0.0) - 1.0);
        let missing = |at: &u32| !picture(root, file_id, *at).is_file();
        let from = from.min(last + STEP_SECS);
        (from..=last).step_by(STEP_SECS as usize).find(missing).or_else(|| {
            (0..from.min(last + 1)).step_by(STEP_SECS as usize).find(missing)
        })
    }

    /// Make the picture at `at` (or read it, made meanwhile) and return its bytes.
    fn take(handle: &mut Frames, root: &std::path::Path, file_id: i64, at: u32, room: &mut Room) -> Option<Vec<u8>> {
        let target = picture(root, file_id, at);
        if let Ok(bytes) = std::fs::read(&target) {
            return Some(bytes);
        }
        let part = target.with_extension("part.jpg");
        handle.picture_at(at, &part)?;
        std::fs::rename(&part, &target).ok()?;
        let bytes = std::fs::read(&target).ok()?;
        room.kept(root, file_id, &target, bytes.len() as u64);
        Some(bytes)
    }

    /// The space the pictures may take ([`super::cap`]), and take now.
    struct Room {
        cap: Option<u64>,
        used: u64,
        /// This film alone fills the cap: no more of it are kept.
        full: bool,
    }

    impl Room {
        fn new(root: &std::path::Path) -> Self {
            let cap = super::cap(root);
            let used = if cap.is_some() { super::usage_in(root).bytes } else { 0 };
            Room { cap, used, full: false }
        }

        /// A picture of `len` bytes was kept: room is made for it, or it goes again.
        fn kept(&mut self, root: &std::path::Path, file_id: i64, target: &std::path::Path, len: u64) {
            let Some(cap) = self.cap else { return };
            self.used += len;
            if self.used <= cap {
                return;
            }
            self.used = super::trim(root, file_id, cap / 10 * 9);
            if self.used > cap {
                let _ = std::fs::remove_file(target);
                self.used = self.used.saturating_sub(len);
                self.full = true;
            }
        }
    }
}

#[cfg(target_os = "ios")]
mod worker {
    use std::path::PathBuf;
    pub fn start(_root: PathBuf, _file_id: i64, _path: String, _size: i64) {}
    pub async fn live(_root: PathBuf, _file_id: i64, _path: String, _size: i64, _at: u32) -> Option<Vec<u8>> {
        None
    }
    pub fn fill(_file_id: i64, _from: Option<u32>) {}
    pub fn stop() {}
}

/// After a picture filled in while watching, the rest before the next: as
/// long as it took, twice that where the system reports two cores or fewer
/// (a TV box), so the share of the CPU it takes is fixed whatever the
/// picture costs (as `preview_job.rs` rests). Never less than the worker's gap.
#[cfg_attr(target_os = "ios", allow(dead_code))]
fn fill_rest(took: std::time::Duration, cores: usize) -> std::time::Duration {
    if cores <= 2 {
        took * 2
    } else {
        took
    }
}

/// What makes the pictures: a second libmpv handle on a computer, the
/// software decoder of `PreviewPlugin.kt` on Android.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use mpv::Handle as Frames;
#[cfg(target_os = "android")]
use android::Handle as Frames;

#[cfg(target_os = "android")]
static PLUGIN: std::sync::OnceLock<tauri::plugin::PluginHandle<tauri::Wry>> = std::sync::OnceLock::new();

/// The Android half (PreviewPlugin.kt), called from Rust alone. Nothing on a computer.
pub fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    #[cfg(desktop)]
    return builder;
    #[cfg(mobile)]
    builder.plugin(
        tauri::plugin::Builder::<tauri::Wry>::new("preview")
            .setup(|_app, api| {
                #[cfg(target_os = "android")]
                {
                    let handle = api.register_android_plugin("com.kinema.app", "PreviewPlugin")?;
                    let _ = PLUGIN.set(handle);
                }
                #[cfg(not(target_os = "android"))]
                let _ = api;
                Ok(())
            })
            .build(),
    )
}

/// Pictures on Android: one file open in `PreviewPlugin.kt` at a time, as the
/// worker holds one handle.
#[cfg(target_os = "android")]
mod android {
    use std::path::Path;

    /// Each picture this wide, as on the desktop (`scale=320:-2`).
    const WIDTH: u32 = 320;

    pub struct Handle {
        /// The session in the plugin: closing an older one leaves a newer one open.
        id: u64,
        duration: Option<f64>,
    }

    fn call<T: serde::de::DeserializeOwned>(command: &str, args: serde_json::Value) -> Result<T, String> {
        let plugin = super::PLUGIN.get().ok_or("the picture maker is not ready")?;
        plugin.run_mobile_plugin::<T>(command, args).map_err(|e| e.to_string())
    }

    impl Handle {
        pub fn open(video: &str) -> Option<Self> {
            #[derive(serde::Deserialize)]
            struct Opened {
                id: u64,
                duration: Option<f64>,
                decoder: String,
                transfer: String,
            }
            // A film on a share is read over this device's own link (stream.rs), as the player reads it.
            let source = if crate::netshare::is_share_path(video) {
                crate::stream::address_for(video).ok()?
            } else {
                video.to_string()
            };
            match call::<Opened>("previewOpen", serde_json::json!({ "source": source, "width": WIDTH })) {
                Ok(o) => {
                    crate::log!("seek previews: {} makes them ({} picture)", o.decoder, o.transfer);
                    Some(Handle { id: o.id, duration: o.duration })
                }
                Err(e) => {
                    crate::log!("seek previews: none for this file: {e}");
                    None
                }
            }
        }

        pub fn duration(&self) -> Option<f64> {
            self.duration
        }

        /// The keyframe at or before `at` seconds, written as a JPEG to `out`.
        pub fn picture_at(&mut self, at: u32, out: &Path) -> Option<()> {
            let args = serde_json::json!({ "id": self.id, "atMs": u64::from(at) * 1000, "out": out.to_str()? });
            match call::<serde_json::Value>("previewFrame", args) {
                Ok(_) => out.is_file().then_some(()),
                Err(e) => {
                    crate::log!("seek previews: no picture at {at} s: {e}");
                    None
                }
            }
        }
    }

    impl Drop for Handle {
        fn drop(&mut self) {
            let _ = call::<serde_json::Value>("previewClose", serde_json::json!({ "id": self.id }));
        }
    }
}

/// The second libmpv handle: the client API through the library the player
/// itself loads (videos.rs finds it).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) mod mpv {
    use std::ffi::{c_char, c_int, c_void, CStr, CString};
    use std::path::Path;
    use std::time::{Duration, Instant};

    #[repr(C)]
    struct Event {
        event_id: c_int,
        error: c_int,
        reply_userdata: u64,
        data: *mut c_void,
    }

    type Create = unsafe extern "C" fn() -> *mut c_void;
    type SetOption = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
    type Initialize = unsafe extern "C" fn(*mut c_void) -> c_int;
    type Command = unsafe extern "C" fn(*mut c_void, *mut *const c_char) -> c_int;
    type WaitEvent = unsafe extern "C" fn(*mut c_void, f64) -> *mut Event;
    type GetString = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_char;
    type Free = unsafe extern "C" fn(*mut c_void);
    type Destroy = unsafe extern "C" fn(*mut c_void);

    const EVENT_SHUTDOWN: c_int = 1;
    const EVENT_END_FILE: c_int = 7;
    const EVENT_PLAYBACK_RESTART: c_int = 21;

    /// Opening a file on a share that does not answer is given up after this.
    const OPEN_WAIT: Duration = Duration::from_secs(15);
    /// One seek and its picture; a 4K HDR film took ~200 ms.
    const SEEK_WAIT: Duration = Duration::from_secs(5);

    pub struct Handle {
        ptr: *mut c_void,
        command: Command,
        wait: WaitEvent,
        get_string: GetString,
        free: Free,
        destroy: Destroy,
    }

    impl Handle {
        pub fn open(video: &str) -> Option<Self> {
            Self::open_with(video, 2)
        }

        /// As [`Handle::open`], decoding on `threads` threads (the whole-library
        /// job uses fewer on a computer that reports few cores).
        pub fn open_with(video: &str, threads: usize) -> Option<Self> {
            let threads = threads.clamp(1, 4).to_string();
            let lib = crate::videos::mpv_frame::library()?;
            // SAFETY: libmpv's client API (client.h), stable across 2.x. The
            // handle is used by the one worker thread that made it, and
            // destroyed in `drop`.
            unsafe {
                let create: Create = *lib.get::<Create>(b"mpv_create\0").ok()?;
                let set: SetOption = *lib.get::<SetOption>(b"mpv_set_option_string\0").ok()?;
                let init: Initialize = *lib.get::<Initialize>(b"mpv_initialize\0").ok()?;
                let handle = Self {
                    ptr: std::ptr::null_mut(),
                    command: *lib.get::<Command>(b"mpv_command\0").ok()?,
                    wait: *lib.get::<WaitEvent>(b"mpv_wait_event\0").ok()?,
                    get_string: *lib.get::<GetString>(b"mpv_get_property_string\0").ok()?,
                    free: *lib.get::<Free>(b"mpv_free\0").ok()?,
                    destroy: *lib.get::<Destroy>(b"mpv_terminate_destroy\0").ok()?,
                };
                let ptr = create();
                if ptr.is_null() {
                    return None;
                }
                let mut handle = handle;
                handle.ptr = ptr;
                let options: &[(&str, &str)] = &[
                    ("config", "no"),
                    ("terminal", "no"),
                    ("vo", "null"),
                    ("ao", "null"),
                    ("audio", "no"),
                    ("sid", "no"),
                    ("pause", "yes"),
                    ("idle", "yes"),
                    ("keep-open", "always"),
                    // Software, on two threads: never a fight with the
                    // player's own decoder for the graphics card.
                    ("hwdec", "no"),
                    ("vd-lavc-threads", threads.as_str()),
                    ("vf", "scale=320:-2"),
                    ("hr-seek", "no"),
                    ("cache", "no"),
                    ("ytdl", "no"),
                    ("load-scripts", "no"),
                    ("osc", "no"),
                    ("input-default-bindings", "no"),
                    ("screenshot-format", "jpg"),
                    ("screenshot-jpeg-quality", "70"),
                ];
                for (name, value) in options {
                    let (Ok(name), Ok(value)) = (CString::new(*name), CString::new(*value)) else {
                        return None;
                    };
                    set(ptr, name.as_ptr(), value.as_ptr());
                }
                if init(ptr) < 0 {
                    return None;
                }
                if !handle.run(&["loadfile", video]) {
                    return None;
                }
                handle.until(EVENT_PLAYBACK_RESTART, OPEN_WAIT).then_some(handle)
            }
        }

        /// The file's length in seconds, as mpv knows it.
        pub fn duration(&self) -> Option<f64> {
            let name = CString::new("duration").ok()?;
            // SAFETY: a string property; the copy mpv returns is freed with mpv_free.
            unsafe {
                let value = (self.get_string)(self.ptr, name.as_ptr());
                if value.is_null() {
                    return None;
                }
                let read = CStr::from_ptr(value).to_str().ok().and_then(|s| s.parse().ok());
                (self.free)(value.cast());
                read
            }
        }

        /// The keyframe at or before `at` seconds, written as a JPEG to `out`.
        pub fn picture_at(&mut self, at: u32, out: &Path) -> Option<()> {
            if !self.run(&["seek", &at.to_string(), "absolute+keyframes"]) {
                return None;
            }
            if !self.until(EVENT_PLAYBACK_RESTART, SEEK_WAIT) {
                return None;
            }
            let out_str = out.to_str()?;
            (self.run(&["screenshot-to-file", out_str, "video"]) && out.is_file()).then_some(())
        }

        fn run(&self, args: &[&str]) -> bool {
            let owned: Vec<CString> = args.iter().filter_map(|a| CString::new(*a).ok()).collect();
            if owned.len() != args.len() {
                return false;
            }
            let mut ptrs: Vec<*const c_char> = owned.iter().map(|a| a.as_ptr()).collect();
            ptrs.push(std::ptr::null());
            // SAFETY: a null-terminated array of C strings that outlive the call.
            unsafe { (self.command)(self.ptr, ptrs.as_mut_ptr()) >= 0 }
        }

        fn until(&self, wanted: c_int, within: Duration) -> bool {
            let started = Instant::now();
            while started.elapsed() < within {
                // SAFETY: the event belongs to mpv and is read before the next wait.
                let id = unsafe {
                    let event = (self.wait)(self.ptr, 0.25);
                    if event.is_null() { 0 } else { (*event).event_id }
                };
                if id == wanted {
                    return true;
                }
                if id == EVENT_END_FILE || id == EVENT_SHUTDOWN {
                    return false;
                }
            }
            false
        }
    }

    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.ptr.is_null() {
                // SAFETY: made by mpv_create in `open`, destroyed once.
                unsafe { (self.destroy)(self.ptr) }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_is_answered_with_the_nearest_step() {
        assert_eq!(step_for(0.0), 0);
        assert_eq!(step_for(4.9), 0);
        assert_eq!(step_for(5.0), 10);
        assert_eq!(step_for(1234.0), 1230);
        assert_eq!(step_for(-3.0), 0);
        assert_eq!(step_for(f64::NAN), 0);
    }

    fn library(dir: &Path) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE media_files (id INTEGER PRIMARY KEY, path TEXT, size_bytes INTEGER);
             INSERT INTO media_files VALUES (1, 'a.mkv', 100), (2, 'b.mkv', 200);",
        )
        .unwrap();
        let _ = std::fs::remove_dir_all(dir);
        conn
    }

    fn make(root: &Path, id: i64, path: &str, size: i64) {
        prepare(root, id, path, size).unwrap();
        std::fs::write(picture(root, id, 10), b"jpg").unwrap();
    }

    #[test]
    fn a_file_that_leaves_the_library_leaves_no_pictures() {
        let root = std::env::temp_dir().join("kinema-seek-preview-sweep");
        let conn = library(&root);
        make(&root, 1, "a.mkv", 100);
        make(&root, 2, "b.mkv", 200);
        make(&root, 3, "gone.mkv", 300);
        std::fs::create_dir_all(root.join("stray")).unwrap();
        assert_eq!(sweep(&conn, &root), 2);
        assert!(picture(&root, 1, 10).is_file());
        assert!(picture(&root, 2, 10).is_file());
        assert!(!file_folder(&root, 3).exists());
        assert_eq!(usage_in(&root), Usage { files: 2, bytes: 6, limit: None });
        // The id now names another file: its pictures go too.
        conn.execute("UPDATE media_files SET path = 'other.mkv' WHERE id = 2", []).unwrap();
        assert_eq!(sweep(&conn, &root), 1);
        assert!(!file_folder(&root, 2).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn filling_in_rests_as_long_as_a_picture_took_twice_on_two_cores() {
        let took = std::time::Duration::from_millis(700);
        assert_eq!(fill_rest(took, 8), took);
        assert_eq!(fill_rest(took, 2), took * 2);
        assert_eq!(fill_rest(took, 1), took * 2);
    }

    #[test]
    fn a_device_keeps_a_tenth_of_its_room_at_most_256_mb() {
        assert_eq!(cap_for(500 * 1024 * 1024), 50 * 1024 * 1024);
        assert_eq!(cap_for(64 * 1024 * 1024 * 1024), CAP_MAX);
        assert_eq!(cap_for(0), 0);
    }

    #[test]
    fn making_room_removes_other_files_oldest_first_and_keeps_the_film() {
        let root = std::env::temp_dir().join("kinema-seek-preview-trim");
        let _ = std::fs::remove_dir_all(&root);
        for id in 1..=3 {
            prepare(&root, id, "x.mkv", id).unwrap();
            for i in 0..3 {
                std::fs::write(picture(&root, id, i * 10), [0u8; 100]).unwrap();
            }
            // Filled at different times: 1 first, 3 last.
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        // 900 bytes, room for 600; the film being watched is 1, the oldest.
        assert_eq!(trim(&root, 1, 600), 600);
        assert!(file_folder(&root, 1).exists(), "the film being watched stays");
        assert!(!file_folder(&root, 2).exists(), "the oldest other file goes first");
        assert!(file_folder(&root, 3).exists(), "no more than needed goes");
        // Under the limit already: nothing goes.
        assert_eq!(trim(&root, 9, 1000), 600);
        assert!(file_folder(&root, 3).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_folder_made_from_another_file_is_emptied_first() {
        let root = std::env::temp_dir().join("kinema-seek-preview-prepare");
        let _ = std::fs::remove_dir_all(&root);
        make(&root, 5, "a.mkv", 100);
        prepare(&root, 5, "a.mkv", 100).unwrap();
        assert!(picture(&root, 5, 10).is_file(), "same file: kept");
        prepare(&root, 5, "a.mkv", 101).unwrap();
        assert!(!picture(&root, 5, 10).is_file(), "replaced file: emptied");
        let _ = std::fs::remove_dir_all(&root);
    }
}
