//! Seek previews for the whole library (round 10, A2): a Settings job, off by
//! default, that makes every library file's pictures (seek_preview.rs) without
//! waiting for the film to be watched.
//!
//! One file at a time on a thread of its own at background priority, with a
//! second libmpv handle (the same one, the same pictures, the same folder and
//! tone mapping as watching makes). Three promises:
//! - **It gives way to a film.** Between two pictures it looks at
//!   [`crate::jobs::playing`]; while a film plays the handle is closed and the
//!   job waits, then goes on where it was.
//! - **It never loads the computer.** After each picture it rests as long as
//!   the picture took (twice as long on a computer that reports two cores or
//!   fewer) and decodes on one thread there, two elsewhere — what the machine
//!   reports, never a measured test box.
//! - **It remembers without a database.** A file is done when its folder holds
//!   a `done` marker naming the same file (path and size, as the folder's
//!   `source` does); a restart lists the files, skips those, and carries on.
//!   Deleting the pictures deletes the markers, and switches the job off.
//!
//! A share that does not answer (the first file of a folder root that cannot
//! be opened) leaves the rest of that root for the next start rather than
//! waiting for each file in turn. Android makes none: the job is not shown
//! there and the commands answer "off" (`capabilities.seek_previews`).

// The job is made by the desktop's libmpv handle; Android's build compiles the
// shared helpers below but has no caller for them (CI's Android lints).
#![cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]

use std::path::Path;

use rusqlite::Connection;

use crate::library::Db;
use crate::util::to_string_err;

/// The setting that says the job is on: `1`, or nothing.
const KEY: &str = "preview_job";

/// Where the job is, for Settings.
#[derive(serde::Serialize, Debug, PartialEq, Eq)]
pub struct Status {
    /// The switch.
    pub enabled: bool,
    /// `off`, `running`, `waiting` (a film is playing), `finished` (every
    /// reachable file is done) or `idle` (on, nothing running yet).
    pub state: &'static str,
    /// Files with all their pictures, and files in the library.
    pub done: u64,
    pub total: u64,
    /// Files left for the next start because their folder did not answer.
    pub unreachable: u64,
}

/// A file the job may make pictures for.
#[derive(Clone, Debug)]
struct Item {
    id: i64,
    root: i64,
    path: String,
    size: i64,
}

/// The library's files, present on disk when last seen.
fn items(conn: &Connection) -> Result<Vec<Item>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, root_id, path, COALESCE(size_bytes, 0) FROM media_files
             WHERE missing = 0 ORDER BY id",
        )
        .map_err(to_string_err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Item { id: r.get(0)?, root: r.get(1)?, path: r.get(2)?, size: r.get(3)? })
        })
        .map_err(to_string_err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(to_string_err)
}

const DONE: &str = "done";

/// Whether every picture of this file is made (and was made from this file).
fn is_done(root: &Path, item: &Item) -> bool {
    std::fs::read_to_string(crate::seek_preview::file_folder(root, item.id).join(DONE)).ok()
        == Some(crate::seek_preview::source_of(&item.path, item.size))
}

fn enabled_in(conn: &Connection) -> bool {
    crate::settings::setting(conn, KEY).as_deref() == Some("1")
}

/// How the job spends the computer: decoding threads, and how many times the
/// length of a picture it rests after it. From what the system reports.
fn effort(cores: usize) -> (usize, u32) {
    if cores <= 2 {
        (1, 2)
    } else {
        (2, 1)
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use desktop::{disable, kick, status};

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn disable(_app: &tauri::AppHandle) {}
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn kick(_app: &tauri::AppHandle) {}
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn status(_app: &tauri::AppHandle) -> Result<Status, String> {
    Ok(Status { enabled: false, state: "off", done: 0, total: 0, unreachable: 0 })
}

/// Settings → Advanced → Seek previews: the switch, and how far the job is.
#[tauri::command]
pub async fn preview_job_status(app: tauri::AppHandle) -> Result<Status, String> {
    crate::jobs::off_main(move || status(&app)).await
}

/// Switch the job on or off. On starts it now; off stops it after the picture
/// being made, and it stays off across restarts.
#[tauri::command]
pub async fn preview_job_set(app: tauri::AppHandle, enabled: bool) -> Result<Status, String> {
    crate::jobs::off_main(move || {
        {
            use tauri::Manager;
            let db = app.state::<Db>();
            let conn = db.0.lock().map_err(to_string_err)?;
            crate::settings::store(&conn, KEY, if enabled { "1" } else { "0" })?;
        }
        if enabled {
            kick(&app);
        } else {
            disable(&app);
        }
        status(&app)
    })
    .await
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop {
    use super::{effort, enabled_in, is_done, items, Item, Status, DONE, KEY};
    use crate::library::Db;
    use crate::seek_preview::{self, mpv::Handle, picture, STEP_SECS};
    use crate::util::to_string_err;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use tauri::Manager;

    /// A run's own stop flag, and which run it is.
    struct Run {
        id: u64,
        stop: Arc<AtomicBool>,
    }
    static RUN: Mutex<Option<Run>> = Mutex::new(None);
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    const S_RUNNING: u8 = 1;
    const S_WAITING: u8 = 2;
    const S_FINISHED: u8 = 3;
    static STATE: AtomicU8 = AtomicU8::new(0);
    static DONE_N: AtomicU64 = AtomicU64::new(0);
    static TOTAL_N: AtomicU64 = AtomicU64::new(0);
    static UNREACHED: AtomicU64 = AtomicU64::new(0);

    /// After launch, the job waits this long: the app's own start-up first.
    const START_DELAY: Duration = Duration::from_secs(20);
    /// How often a waiting job looks again.
    const POLL: Duration = Duration::from_millis(500);
    /// A rest is never shorter than this, however quick the picture was.
    const MIN_REST: Duration = Duration::from_millis(60);

    fn root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
        Ok(seek_preview::folder_in(&crate::data_dir(app)?))
    }

    /// Where the job is, for Settings. Counts what is on disk when no run holds them.
    pub fn status(app: &tauri::AppHandle) -> Result<Status, String> {
        let db = app.state::<Db>();
        let (enabled, files) = {
            let conn = db.0.lock().map_err(to_string_err)?;
            (enabled_in(&conn), items(&conn)?)
        };
        let running = RUN.lock().map_err(to_string_err)?.is_some();
        if running {
            let state = match STATE.load(Ordering::Relaxed) {
                S_WAITING => "waiting",
                _ => "running",
            };
            return Ok(Status {
                enabled,
                state,
                done: DONE_N.load(Ordering::Relaxed),
                total: TOTAL_N.load(Ordering::Relaxed),
                unreachable: UNREACHED.load(Ordering::Relaxed),
            });
        }
        let dir = root(app)?;
        let done = files.iter().filter(|i| is_done(&dir, i)).count() as u64;
        let finished = STATE.load(Ordering::Relaxed) == S_FINISHED;
        Ok(Status {
            enabled,
            state: match (enabled, finished) {
                (false, _) => "off",
                (true, true) => "finished",
                (true, false) => "idle",
            },
            done,
            total: files.len() as u64,
            unreachable: if finished { UNREACHED.load(Ordering::Relaxed) } else { 0 },
        })
    }

    /// Stop the run, if there is one, after the picture it is making.
    fn stop_run() {
        if let Ok(mut run) = RUN.lock() {
            if let Some(r) = run.take() {
                r.stop.store(true, Ordering::Relaxed);
            }
        }
        STATE.store(0, Ordering::Relaxed);
    }

    /// Off: the setting, and the run.
    pub fn disable(app: &tauri::AppHandle) {
        {
            let db = app.state::<Db>();
            let stored = db.0.lock().map(|conn| crate::settings::store(&conn, KEY, "0"));
            drop(stored);
        }
        stop_run();
    }

    /// Start a run if the job is on and none is running: at launch (after a
    /// delay), when the switch goes on, and after a scan found new files.
    pub fn kick(app: &tauri::AppHandle) {
        {
            let db = app.state::<Db>();
            let Ok(conn) = db.0.lock() else { return };
            if !enabled_in(&conn) {
                return;
            }
        }
        let Ok(mut run) = RUN.lock() else { return };
        if run.is_some() {
            return;
        }
        let stop = Arc::new(AtomicBool::new(false));
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let (app2, stop2) = (app.clone(), stop.clone());
        let first = id == 1;
        let started = std::thread::Builder::new()
            .name("kinema-preview-job".into())
            .spawn(move || {
                let _low = crate::jobs::background();
                if first {
                    nap(&stop2, START_DELAY);
                }
                if !stop2.load(Ordering::Relaxed) {
                    pass(&app2, &stop2);
                }
                if let Ok(mut run) = RUN.lock() {
                    if run.as_ref().is_some_and(|r| r.id == id) {
                        *run = None;
                    }
                }
            });
        if started.is_ok() {
            // Nothing of an earlier run's count is this run's.
            UNREACHED.store(0, Ordering::Relaxed);
            STATE.store(S_RUNNING, Ordering::Relaxed);
            *run = Some(Run { id, stop });
        }
    }

    /// Sleep, in short pieces, until `d` has passed or the run is stopped.
    fn nap(stop: &AtomicBool, d: Duration) {
        let until = Instant::now() + d;
        while Instant::now() < until && !stop.load(Ordering::Relaxed) {
            std::thread::sleep(POLL.min(until.saturating_duration_since(Instant::now())));
        }
    }

    /// Wait while a film plays; false if the run was stopped meanwhile.
    fn wait_for_film(stop: &AtomicBool) -> bool {
        if crate::jobs::playing() || crate::jobs::behind() {
            STATE.store(S_WAITING, Ordering::Relaxed);
            while (crate::jobs::playing() || crate::jobs::behind()) && !stop.load(Ordering::Relaxed) {
                std::thread::sleep(POLL);
            }
            STATE.store(S_RUNNING, Ordering::Relaxed);
        }
        !stop.load(Ordering::Relaxed)
    }

    /// One pass over the library: every file not done yet, once.
    fn pass(app: &tauri::AppHandle, stop: &AtomicBool) {
        let Ok(dir) = root(app) else { return };
        let db = app.state::<Db>();
        let files = {
            let Ok(conn) = db.0.lock() else { return };
            // Files that left the library while Kinema Media was closed go first.
            if dir.exists() {
                seek_preview::sweep(&conn, &dir);
            }
            match items(&conn) {
                Ok(f) => f,
                Err(_) => return,
            }
        };
        let todo: Vec<&Item> = files.iter().filter(|i| !is_done(&dir, i)).collect();
        TOTAL_N.store(files.len() as u64, Ordering::Relaxed);
        DONE_N.store((files.len() - todo.len()) as u64, Ordering::Relaxed);
        UNREACHED.store(0, Ordering::Relaxed);
        let cores = std::thread::available_parallelism().map_or(2, |n| n.get());
        let (threads, rest) = effort(cores);
        crate::log!(
            "preview job: {} of {} files to do, {threads} decoding thread(s), resting {rest}× each picture",
            todo.len(),
            files.len()
        );
        let mut dead_roots: HashSet<i64> = HashSet::new();
        let mut unreached = 0u64;
        for item in todo {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            if dead_roots.contains(&item.root) {
                unreached += 1;
                continue;
            }
            // Still in the library? (A folder can be removed during a pass.)
            let present = db
                .0
                .lock()
                .ok()
                .and_then(|c| seek_preview::file_row(&c, item.id).ok().flatten())
                .is_some_and(|(p, s)| p == item.path && s == item.size);
            if !present {
                continue;
            }
            match make_file(&dir, item, threads, rest, stop) {
                Outcome::Done => {
                    DONE_N.fetch_add(1, Ordering::Relaxed);
                }
                Outcome::Stopped => return,
                Outcome::Unreachable => {
                    dead_roots.insert(item.root);
                    unreached += 1;
                    UNREACHED.store(unreached, Ordering::Relaxed);
                }
            }
        }
        UNREACHED.store(unreached, Ordering::Relaxed);
        crate::log!("preview job: pass finished, {unreached} file(s) left for the next start");
        STATE.store(S_FINISHED, Ordering::Relaxed);
    }

    enum Outcome {
        Done,
        Stopped,
        Unreachable,
    }

    /// Every missing picture of one file, then its `done` marker.
    fn make_file(dir: &std::path::Path, item: &Item, threads: usize, rest: u32, stop: &AtomicBool) -> Outcome {
        if !wait_for_film(stop) {
            return Outcome::Stopped;
        }
        if seek_preview::prepare(dir, item.id, &item.path, item.size).is_err() {
            return Outcome::Unreachable;
        }
        // A picture half written when the app last closed.
        if let Ok(entries) = std::fs::read_dir(seek_preview::file_folder(dir, item.id)) {
            for e in entries.flatten() {
                if e.file_name().to_string_lossy().ends_with(".part.jpg") {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        let started = Instant::now();
        let mut handle: Option<Handle> = None;
        let mut duration = None;
        let mut made = 0u32;
        let mut opened_ms = 0u128;
        let mut at = 0u32;
        loop {
            if stop.load(Ordering::Relaxed) {
                return Outcome::Stopped;
            }
            // A film starts: let go of the handle (and the share), wait, reopen.
            if crate::jobs::playing() || crate::jobs::behind() {
                handle = None;
                if !wait_for_film(stop) {
                    return Outcome::Stopped;
                }
            }
            let h = match handle.as_mut() {
                Some(h) => h,
                None => {
                    let t = Instant::now();
                    let Some(h) = Handle::open_with(&item.path, threads) else {
                        crate::log!("preview job: could not open file {} for pictures", item.id);
                        return Outcome::Unreachable;
                    };
                    opened_ms += t.elapsed().as_millis();
                    duration = duration.or_else(|| h.duration());
                    handle.insert(h)
                }
            };
            let Some(length) = duration else {
                return Outcome::Unreachable;
            };
            let last = seek_preview::step_for((length - 1.0).max(0.0));
            if at > last {
                break;
            }
            let target = picture(dir, item.id, at);
            if !target.is_file() {
                let t = Instant::now();
                let part = target.with_extension("part.jpg");
                let ok = h.picture_at(at, &part).is_some() && std::fs::rename(&part, &target).is_ok();
                if !ok {
                    let _ = std::fs::remove_file(&part);
                    // One bad spot in a file is not the file: go on to the next picture.
                    at += STEP_SECS;
                    continue;
                }
                made += 1;
                nap(stop, (t.elapsed() * rest).max(MIN_REST));
            }
            at += STEP_SECS;
        }
        drop(handle);
        let marker = seek_preview::file_folder(dir, item.id).join(DONE);
        let source = seek_preview::source_of(&item.path, item.size);
        if std::fs::write(&marker, source).is_err() {
            return Outcome::Unreachable;
        }
        crate::log!(
            "preview job: file {} done: {made} new picture(s) in {} s (open {opened_ms} ms)",
            item.id,
            started.elapsed().as_secs()
        );
        Outcome::Done
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_computer_with_few_cores_decodes_on_one_and_rests_longer() {
        assert_eq!(effort(1), (1, 2));
        assert_eq!(effort(2), (1, 2));
        assert_eq!(effort(4), (2, 1));
        assert_eq!(effort(16), (2, 1));
    }

    #[test]
    fn a_file_is_done_only_while_its_marker_names_the_same_file() {
        let root = std::env::temp_dir().join(format!("skrin-job-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let item = Item { id: 7, root: 1, path: "/m/a.mkv".into(), size: 100 };
        assert!(!is_done(&root, &item));
        crate::seek_preview::prepare(&root, 7, &item.path, item.size).unwrap();
        assert!(!is_done(&root, &item), "pictures begun, not done");
        let marker = crate::seek_preview::file_folder(&root, 7).join(DONE);
        std::fs::write(&marker, crate::seek_preview::source_of(&item.path, item.size)).unwrap();
        assert!(is_done(&root, &item));
        // The file was replaced in place: another size, so the old marker no longer counts.
        let replaced = Item { size: 200, ..item.clone() };
        assert!(!is_done(&root, &replaced));
        // …and preparing for it empties the folder, marker included.
        crate::seek_preview::prepare(&root, 7, &replaced.path, replaced.size).unwrap();
        assert!(!marker.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_job_lists_present_files_only_and_the_setting_is_read_as_on() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE media_files (id INTEGER PRIMARY KEY, root_id INTEGER, path TEXT,
               size_bytes INTEGER, missing INTEGER);
             INSERT INTO media_files VALUES (1, 1, 'a', 10, 0), (2, 1, 'b', 20, 1), (3, 2, 'c', NULL, 0);
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);",
        )
        .unwrap();
        let got = items(&conn).unwrap();
        assert_eq!(got.iter().map(|i| i.id).collect::<Vec<_>>(), vec![1, 3]);
        assert_eq!(got[1].size, 0);
        assert!(!enabled_in(&conn));
        conn.execute("INSERT INTO settings VALUES ('preview_job', '1')", []).unwrap();
        assert!(enabled_in(&conn));
    }
}
