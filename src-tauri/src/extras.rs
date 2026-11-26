//! Extras and theme music kept beside a film or show — read, never written.
//!
//! The conventions are the ones Plex, Jellyfin and Kodi share, so a library
//! that already has them keeps working and one made here stays readable by
//! them: `Extras`, `Featurettes`, `Behind The Scenes`, `Deleted Scenes`,
//! `Interviews`, `Scenes`, `Shorts` and `Other` folders next to the film, or a
//! file named `…-featurette.mkv`; and `theme.mp3` (or `theme-music/`,
//! `backdrops/theme.mp3`) for a show's or film's tune. `Trailers` and
//! `-trailer` files are the trailer button's (`trailer.rs`), not listed here.
//!
//! Like the trailer, a film's extras are looked for in its own folder, and a
//! show's one level up from a season folder.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// The folders extras live in, as Plex names them (compared in lower case).
const EXTRA_DIRS: &[&str] = &[
    "extras",
    "featurettes",
    "behind the scenes",
    "deleted scenes",
    "interviews",
    "scenes",
    "shorts",
    "other",
];

/// Filename endings that mark an extra beside the film (Jellyfin's and
/// Plex's suffixes, with `-`, `.` or `_` before them), and what each is.
/// The space-separated form is not read, for the reason `trailer.rs` gives;
/// nor are `-scene`, `-short` and `-other`, which end real titles (those
/// three are read as folders only).
const EXTRA_SUFFIXES: &[(&str, &str)] = &[
    ("featurette", "Featurettes"),
    ("behindthescenes", "Behind the scenes"),
    ("deleted", "Deleted scenes"),
    ("interview", "Interviews"),
];

/// How many extras one page lists at most.
const EXTRAS_LIMIT: usize = 60;

/// Largest theme file read into the page: a tune, not a film.
const THEME_LIMIT: u64 = 25 * 1024 * 1024;

/// The sound files a theme can be (what the page's own player can open).
const THEME_EXTENSIONS: &[&str] = &["mp3", "flac", "ogg", "opus", "m4a", "aac", "wav"];

#[derive(Serialize, Debug, PartialEq)]
pub struct Extra {
    pub path: String,
    pub name: String,
    /// The group it is shown under: `Featurettes`, `Deleted scenes`…
    pub kind: String,
}

fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(crate::trailer::is_video_ext)
}

/// The group an extra-suffixed file name belongs to, and the name without
/// the suffix. `None` for anything that is not one.
pub fn extra_file_name(file_name: &str) -> Option<(&'static str, String)> {
    let (stem, _ext) = file_name.rsplit_once('.')?;
    let lower = stem.to_lowercase();
    for (word, kind) in EXTRA_SUFFIXES {
        for sep in ['-', '.', '_'] {
            let tail = format!("{sep}{word}");
            if lower.ends_with(&tail) {
                let name = stem[..stem.len() - tail.len()].trim().to_string();
                return Some((kind, name));
            }
        }
        if lower == *word {
            return Some((kind, String::new()));
        }
    }
    None
}

/// Whether a file name is an extra (the scanner leaves these out, as it does
/// trailers: otherwise each would become a junk title of its own).
pub fn is_extra_file_name(file_name: &str) -> bool {
    extra_file_name(file_name).is_some()
}

fn capitalise(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

fn pretty(stem: &str) -> String {
    stem.replace(['_', '.'], " ").trim().to_string()
}

fn extras_in(dir: &Path, out: &mut Vec<Extra>) {
    let Ok(entries) = crate::files::read_dir(dir) else {
        return;
    };
    for (path, is_dir) in &entries {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if *is_dir {
            let lower = name.to_lowercase();
            if !EXTRA_DIRS.contains(&lower.as_str()) {
                continue;
            }
            let Ok(inside) = crate::files::read_dir(path) else {
                continue;
            };
            let kind = capitalise(&lower);
            for (file, file_is_dir) in inside {
                if file_is_dir || !is_video(&file) {
                    continue;
                }
                let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                out.push(Extra {
                    path: file.display().to_string(),
                    name: pretty(stem),
                    kind: kind.clone(),
                });
            }
        } else if is_video(path) {
            if let Some((kind, stripped)) = extra_file_name(name) {
                let name = if stripped.is_empty() { kind.to_string() } else { pretty(&stripped) };
                out.push(Extra { path: path.display().to_string(), name, kind: kind.to_string() });
            }
        }
    }
}

/// The folder a title's own things sit in: the video's folder, or for a
/// season folder the show's.
fn title_dirs(video: &Path) -> Vec<PathBuf> {
    let Some(dir) = video.parent() else {
        return Vec::new();
    };
    let mut dirs = vec![dir.to_path_buf()];
    let is_season = dir
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(crate::util::is_season_folder);
    if is_season {
        if let Some(up) = dir.parent() {
            dirs.push(up.to_path_buf());
        }
    }
    dirs
}

pub(crate) fn local_extras(video: &Path) -> Vec<Extra> {
    let mut out = Vec::new();
    for dir in title_dirs(video) {
        extras_in(&dir, &mut out);
    }
    let order = |k: &str| {
        EXTRA_DIRS
            .iter()
            .position(|d| capitalise(d).to_lowercase() == k.to_lowercase())
            .unwrap_or(usize::MAX)
    };
    out.sort_by(|a, b| {
        order(&a.kind)
            .cmp(&order(&b.kind))
            .then_with(|| a.kind.cmp(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out.dedup_by(|a, b| a.path == b.path);
    out.truncate(EXTRAS_LIMIT);
    out
}

/// A film's or show's extras on disk, anchored on one of its files. Off the
/// main thread, as the trailer is: it lists folders on what is often a NAS.
#[tauri::command]
pub async fn list_extras(video_path: String) -> Result<Vec<Extra>, String> {
    crate::jobs::off_main(move || Ok(local_extras(Path::new(&video_path)))).await
}

fn is_theme_file(path: &Path, stem_ok: impl Fn(&str) -> bool) -> bool {
    let ext_ok = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| THEME_EXTENSIONS.contains(&e.to_lowercase().as_str()));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    ext_ok && stem_ok(&stem.to_lowercase())
}

fn theme_in(dir: &Path) -> Option<PathBuf> {
    let beside = |d: &Path, folder: bool| -> Option<PathBuf> {
        let mut found: Vec<PathBuf> = crate::files::read_dir(d)
            .ok()?
            .into_iter()
            .filter(|(_, is_dir)| !is_dir)
            .map(|(p, _)| p)
            .filter(|p| is_theme_file(p, |s| if folder { true } else { s == "theme" }))
            .collect();
        found.sort();
        found.into_iter().next()
    };
    if let Some(p) = beside(dir, false) {
        return Some(p);
    }
    let entries = crate::files::read_dir(dir).ok()?;
    for (sub, is_dir) in entries {
        if !is_dir {
            continue;
        }
        let name = sub.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
        if name == "theme-music" {
            if let Some(p) = beside(&sub, true) {
                return Some(p);
            }
        } else if name == "backdrops" {
            if let Some(p) = beside(&sub, false) {
                return Some(p);
            }
        }
    }
    None
}

pub(crate) fn local_theme(video: &Path) -> Option<PathBuf> {
    title_dirs(video).into_iter().rev().find_map(|d| theme_in(&d))
}

/// What the theme file is, for the page's player.
fn audio_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref() {
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("ogg") | Some("opus") => "audio/ogg",
        Some("m4a") | Some("aac") => "audio/mp4",
        Some("wav") => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// The theme tune beside a title's files: its type, then its bytes in one
/// answer (`type\n` first, a line the page cuts off). Empty when there is
/// none, or the file is too large to be a tune. The path is found again
/// here from the video's, never taken from the page.
#[tauri::command]
pub async fn read_theme(video_path: String) -> Result<tauri::ipc::Response, String> {
    crate::jobs::off_main(move || {
        let Some(path) = local_theme(Path::new(&video_path)) else {
            return Ok(tauri::ipc::Response::new(Vec::new()));
        };
        match crate::files::metadata(&path) {
            Ok(m) if m.len <= THEME_LIMIT => {}
            _ => return Ok(tauri::ipc::Response::new(Vec::new())),
        }
        let Ok(bytes) = crate::files::read(&path) else {
            return Ok(tauri::ipc::Response::new(Vec::new()));
        };
        let mut out = format!("{}\n", audio_type(&path)).into_bytes();
        out.extend(bytes);
        Ok(tauri::ipc::Response::new(out))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("skrin-extras-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn suffixes_name_the_group_and_leave_ordinary_titles_alone() {
        assert_eq!(
            extra_file_name("Making Of-featurette.mkv"),
            Some(("Featurettes", "Making Of".to_string()))
        );
        assert_eq!(extra_file_name("Cut.deleted.mp4").map(|e| e.0), Some("Deleted scenes"));
        assert!(!is_extra_file_name("Thing-short.mkv") && !is_extra_file_name("Thing-scene.mkv"));
        assert_eq!(extra_file_name("Talk_interview.mkv").map(|e| e.0), Some("Interviews"));
        for name in ["The Short.mkv", "Short Circuit (1986).mkv", "Other People (2016).mkv", "Scene Stealers.mkv"] {
            assert!(!is_extra_file_name(name), "{name} is a film");
        }
    }

    #[test]
    fn folders_and_suffixed_files_are_listed_by_group_and_the_rest_left_out() {
        let root = scratch("list");
        let film = root.join("Example (2020)");
        touch(&film.join("Example (2020).mkv"));
        touch(&film.join("Extras").join("Bloopers.mkv"));
        touch(&film.join("Featurettes").join("The Look.mp4"));
        touch(&film.join("Featurettes").join("notes.txt"));
        touch(&film.join("Trailers").join("A trailer.mkv"));
        touch(&film.join("Example-trailer.mkv"));
        touch(&film.join("Cut-deleted.mkv"));
        touch(&film.join("Holiday").join("clip.mkv"));
        let found = local_extras(&film.join("Example (2020).mkv"));
        let listed: Vec<(String, String)> =
            found.iter().map(|e| (e.kind.clone(), e.name.clone())).collect();
        assert_eq!(
            listed,
            vec![
                ("Extras".to_string(), "Bloopers".to_string()),
                ("Featurettes".to_string(), "The Look".to_string()),
                ("Deleted scenes".to_string(), "Cut".to_string()),
            ]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_shows_extras_and_theme_are_found_from_a_season_folder() {
        let root = scratch("show");
        let show = root.join("Show");
        touch(&show.join("Season 1").join("Show S01E01.mkv"));
        touch(&show.join("Extras").join("Reunion.mkv"));
        touch(&show.join("Theme.MP3"));
        let episode = show.join("Season 1").join("Show S01E01.mkv");
        assert_eq!(local_extras(&episode).len(), 1);
        assert_eq!(local_theme(&episode), Some(show.join("Theme.MP3")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn theme_files_follow_the_three_conventions_and_nothing_else() {
        let root = scratch("theme");
        let a = root.join("A");
        touch(&a.join("A.mkv"));
        touch(&a.join("theme-music").join("main tune.flac"));
        assert_eq!(local_theme(&a.join("A.mkv")), Some(a.join("theme-music").join("main tune.flac")));
        let b = root.join("B");
        touch(&b.join("B.mkv"));
        touch(&b.join("backdrops").join("theme.mp3"));
        assert_eq!(local_theme(&b.join("B.mkv")), Some(b.join("backdrops").join("theme.mp3")));
        let c = root.join("C");
        touch(&c.join("C.mkv"));
        touch(&c.join("theme song.txt"));
        touch(&c.join("soundtrack.mp3"));
        assert_eq!(local_theme(&c.join("C.mkv")), None);
        let _ = std::fs::remove_dir_all(&root);
    }
}
