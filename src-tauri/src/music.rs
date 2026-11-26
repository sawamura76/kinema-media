//! Audio library scanner and index. Music never enters the movie/TV matching pipeline.
use crate::library::Db;
use lofty::{
    file::{AudioFile, TaggedFileExt},
    tag::{Accessor, ItemKey},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const EXTENSIONS: &[&str] = &[
    "mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "aif", "aiff", "ape", "wv",
];
static SCANNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub(super) struct ScanGuard;
impl Drop for ScanGuard {
    fn drop(&mut self) {
        SCANNING.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[derive(Serialize)]
pub struct MusicRoot {
    id: i64,
    path: String,
    collection_id: i64,
}
#[derive(Serialize)]
pub struct MusicTrack {
    pub(super) id: i64,
    pub(super) path: String,
    pub(super) title: String,
    pub(super) artist: String,
    pub(super) album_artist: String,
    pub(super) album: String,
    pub(super) track: u32,
    pub(super) disc: u32,
    pub(super) duration: f64,
    pub(super) genre: String,
    pub(super) year: Option<i64>,
    pub(super) artwork: Option<String>,
    pub(super) missing: bool,
}
#[derive(Serialize)]
pub struct MusicCollection {
    id: i64,
    name: String,
    default_sort: String,
    background_kind: String,
    background_path: String,
}
#[derive(Serialize)]
pub struct CollectionTrack {
    track_id: i64,
    collection_id: i64,
}
#[derive(Serialize)]
pub struct MusicLibrary {
    collections: Vec<MusicCollection>,
    collection_tracks: Vec<CollectionTrack>,
    roots: Vec<MusicRoot>,
    tracks: Vec<MusicTrack>,
}
#[derive(Default, Serialize)]
pub struct ScanReport {
    added: usize,
    updated: usize,
    unchanged: usize,
    missing: usize,
    errors: Vec<String>,
}

#[tauri::command]
pub fn music_library(db: tauri::State<Db>) -> Result<MusicLibrary, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let roots = conn
        .prepare("SELECT id,path,collection_id FROM music_roots ORDER BY path")
        .map_err(|e| e.to_string())?
        .query_map([], |r| {
            Ok(MusicRoot {
                id: r.get(0)?,
                path: r.get(1)?,
                collection_id: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let tracks = conn.prepare("SELECT id,path,title,artist,album_artist,album,track,disc,duration,genre,year,artwork,missing FROM music_tracks ORDER BY album_artist COLLATE NOCASE,album COLLATE NOCASE,disc,track,title COLLATE NOCASE").map_err(|e|e.to_string())?
        .query_map([], track_row).map_err(|e|e.to_string())?
        .collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    let collections = conn
        .prepare("SELECT id,name,default_sort,background_kind,background_path FROM music_collections ORDER BY name COLLATE NOCASE")
        .map_err(|e| e.to_string())?
        .query_map([], |row| {
            Ok(MusicCollection {
                id: row.get(0)?,
                name: row.get(1)?,
                default_sort: row.get(2)?,
                background_kind: row.get(3)?,
                background_path: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let collection_tracks = conn
        .prepare(
            "SELECT t.id,r.collection_id FROM music_tracks t JOIN music_roots r ON r.id=t.root_id",
        )
        .map_err(|e| e.to_string())?
        .query_map([], |row| {
            Ok(CollectionTrack {
                track_id: row.get(0)?,
                collection_id: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(MusicLibrary {
        roots,
        tracks,
        collections,
        collection_tracks,
    })
}

pub(super) fn track_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<MusicTrack> {
    Ok(MusicTrack {
        id: r.get(0)?,
        path: r.get(1)?,
        title: r.get(2)?,
        artist: r.get(3)?,
        album_artist: r.get(4)?,
        album: r.get(5)?,
        track: r.get(6)?,
        disc: r.get(7)?,
        duration: r.get(8)?,
        genre: r.get(9)?,
        year: r.get(10)?,
        artwork: r.get(11)?,
        missing: r.get(12)?,
    })
}

#[tauri::command]
pub fn music_add_root(
    db: tauri::State<Db>,
    path: String,
    collection_id: Option<i64>,
) -> Result<(), String> {
    let path = std::fs::canonicalize(path).map_err(|e| format!("Cannot open music folder: {e}"))?;
    if !path.is_dir() {
        return Err("Choose a folder, rather than a file.".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // Overlapping roots make removal ambiguous. Reject them, including case differences on Windows.
    let mut q = conn
        .prepare("SELECT path FROM music_roots")
        .map_err(|e| e.to_string())?;
    let paths = q
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for old in paths {
        let old = PathBuf::from(old.map_err(|e| e.to_string())?);
        if path.starts_with(&old) || old.starts_with(&path) {
            return Err("That folder, or a folder inside it, is already in Music.".into());
        }
    }
    conn.execute(
        "INSERT INTO music_roots(path,collection_id) VALUES (?1,?2)",
        params![path.to_string_lossy().as_ref(), collection_id.unwrap_or(1)],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn music_remove_root(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .execute("DELETE FROM music_roots WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn text(value: Option<std::borrow::Cow<'_, str>>, fallback: &str) -> String {
    value
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_owned())
}

fn cover(
    path: &Path,
    tag: Option<&lofty::tag::Tag>,
    cache: &Path,
    identity: &str,
) -> Option<String> {
    // Decode and resize to bound both the cache and WebView memory; reject malformed pictures.
    let embedded = tag
        .and_then(|t| {
            t.pictures()
                .iter()
                .find(|p| p.pic_type() == lofty::picture::PictureType::CoverFront)
                .or_else(|| t.pictures().first())
        })
        .and_then(|p| image::load_from_memory(p.data()).ok());
    let picture = embedded.or_else(|| {
        let dir = path.parent()?;
        [
            "cover.jpg",
            "folder.jpg",
            "cover.png",
            "folder.png",
            "Cover.jpg",
            "Folder.jpg",
        ]
        .iter()
        .find_map(|n| image::open(dir.join(n)).ok())
    })?;
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    identity.hash(&mut h);
    let dest = cache.join(format!("music-{:016x}.jpg", h.finish()));
    picture.thumbnail(600, 600).to_rgb8().save(&dest).ok()?;
    Some(dest.to_string_lossy().into_owned())
}

pub(super) fn file_stamp(metadata: &std::fs::Metadata) -> (i64, i64) {
    let size = metadata.len() as i64;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|t| t.as_nanos().min(i64::MAX as u128) as i64)
        .unwrap_or(0);
    (size, modified)
}

pub(super) fn scan(conn: &Connection, cache: &Path) -> Result<ScanReport, String> {
    std::fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let roots = conn
        .prepare("SELECT id,path FROM music_roots")
        .map_err(|e| e.to_string())?
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut report = ScanReport::default();
    for (root_id, root) in roots {
        // An unreadable/offline root must not make an entire collection disappear.
        if let Err(e) = std::fs::read_dir(&root) {
            report.errors.push(format!("{root}: {e}"));
            continue;
        }
        let mut seen = HashSet::new();
        let mut complete = true;
        for entry in walkdir::WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                entry.depth() == 0
                    || !entry.file_type().is_dir()
                    || !entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".kinema-tag-")
            })
        {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    report.errors.push(e.to_string());
                    complete = false;
                    continue;
                }
            };
            let path = entry.path();
            if !entry.file_type().is_file()
                || !path
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
            {
                continue;
            }
            let key = path.to_string_lossy().into_owned();
            seen.insert(key.clone());
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(e) => {
                    report.errors.push(e.to_string());
                    continue;
                }
            };
            let (size, modified) = file_stamp(&meta);
            let previous = conn
                .query_row(
                    "SELECT size_bytes,modified_at FROM music_tracks WHERE path=?1",
                    [&key],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if previous == Some((size, modified)) {
                conn.execute("UPDATE music_tracks SET missing=0 WHERE path=?1", [&key])
                    .map_err(|e| e.to_string())?;
                report.unchanged += 1;
                continue;
            }
            let file = match lofty::read_from_path(path) {
                Ok(f) => f,
                Err(e) => {
                    report.errors.push(format!("{key}: {e}"));
                    continue;
                }
            };
            let tag = file.primary_tag().or_else(|| file.first_tag());
            let fallback = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled");
            let title = text(tag.and_then(|t| t.title()), fallback);
            let artist = text(tag.and_then(|t| t.artist()), "Unknown artist");
            let album = text(tag.and_then(|t| t.album()), "Unknown album");
            let album_artist = tag
                .and_then(|t| t.get_string(ItemKey::AlbumArtist))
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(&artist)
                .to_owned();
            let track = tag.and_then(|t| t.track()).unwrap_or(0);
            let disc = tag.and_then(|t| t.disk()).unwrap_or(1);
            let genre = text(tag.and_then(|t| t.genre()), "");
            let year = tag.and_then(|t| t.date()).map(|d| i64::from(d.year));
            let art = cover(path, tag, cache, &format!("{key}:{size}:{modified}"))
                .or_else(|| crate::album_art::cached_cover(cache, &album_artist, &album));
            conn.execute("INSERT INTO music_tracks(root_id,path,size_bytes,modified_at,title,artist,album_artist,album,track,disc,duration,genre,year,artwork) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14) ON CONFLICT(path) DO UPDATE SET size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,title=excluded.title,artist=excluded.artist,album_artist=excluded.album_artist,album=excluded.album,track=excluded.track,disc=excluded.disc,duration=excluded.duration,genre=excluded.genre,year=excluded.year,artwork=excluded.artwork,missing=0",
                params![root_id,key,size,modified,title,artist,album_artist,album,track,disc,file.properties().duration().as_secs_f64(),genre,year,art]).map_err(|e|e.to_string())?;
            if previous.is_some() {
                report.updated += 1
            } else {
                report.added += 1
            }
        }
        if complete {
            let old = conn
                .prepare("SELECT path FROM music_tracks WHERE root_id=?1 AND missing=0")
                .map_err(|e| e.to_string())?
                .query_map([root_id], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            for key in old {
                if !seen.contains(&key) {
                    conn.execute("UPDATE music_tracks SET missing=1 WHERE path=?1", [key])
                        .map_err(|e| e.to_string())?;
                    report.missing += 1;
                }
            }
        }
    }
    Ok(report)
}

pub(super) fn exclusive() -> Result<ScanGuard, String> {
    if SCANNING
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::AcqRel,
            std::sync::atomic::Ordering::Acquire,
        )
        .is_err()
    {
        return Err("A music scan or tag save is already running. Please let it finish.".into());
    }
    Ok(ScanGuard)
}

#[tauri::command]
pub async fn music_scan(app: tauri::AppHandle) -> Result<ScanReport, String> {
    let guard = exclusive()?;
    let dir = crate::data_dir(&app)?;
    crate::jobs::off_main(move || {
        let _guard = guard;
        // A separate connection keeps ordinary browsing responsive while tags are read.
        let conn = Connection::open(dir.join("library.db")).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| e.to_string())?;
        scan(&conn, &dir.join("artwork"))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_or_whitespace_tags_use_a_readable_fallback() {
        assert_eq!(text(Some("  ".into()), "Unknown artist"), "Unknown artist");
        assert_eq!(text(Some(" Artist ".into()), "Unknown artist"), "Artist");
    }
    #[test]
    fn offline_root_preserves_existing_tracks() {
        let conn = Connection::open_in_memory().unwrap();
        for migration in crate::db::MIGRATIONS {
            conn.execute_batch(migration).unwrap();
        }
        conn.execute(
            "INSERT INTO music_roots(path) VALUES ('Z:/kinema-nonexistent-test-root')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO music_tracks(root_id,path,size_bytes,modified_at,title,artist,album_artist,album) VALUES (1,'gone.mp3',0,0,'Song','Artist','Artist','Album')",[]).unwrap();
        let report = scan(&conn, &std::env::temp_dir().join("kinema-music-test-art")).unwrap();
        assert!(!report.errors.is_empty());
        assert_eq!(
            conn.query_row("SELECT missing FROM music_tracks", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn tags_rescans_missing_and_restored_files() {
        use lofty::tag::{Tag, TagExt, TagType};
        let conn = Connection::open_in_memory().unwrap();
        for migration in crate::db::MIGRATIONS {
            conn.execute_batch(migration).unwrap();
        }
        let dir = std::env::temp_dir().join(format!(
            "kinema-audio-fixture-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("夜に駆ける－テスト音楽.wav");
        // A synthetic one-second PCM file; no personal audio is used by tests.
        let mut wav = b"RIFF".to_vec();
        wav.extend(16036u32.to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16u32.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(8000u32.to_le_bytes());
        wav.extend(16000u32.to_le_bytes());
        wav.extend(2u16.to_le_bytes());
        wav.extend(16u16.to_le_bytes());
        wav.extend(b"data");
        wav.extend(16000u32.to_le_bytes());
        wav.resize(16044, 0);
        std::fs::write(&path, wav).unwrap();
        let mut tag = Tag::new(TagType::Id3v2);
        tag.set_title("夜に駆ける".into());
        tag.set_artist("テストアーティスト".into());
        tag.set_album("日本語のアルバム".into());
        tag.save_to_path(&path, lofty::config::WriteOptions::default())
            .unwrap();
        conn.execute(
            "INSERT INTO music_roots(path) VALUES (?1)",
            [dir.to_string_lossy().as_ref()],
        )
        .unwrap();
        let cache = dir.join("artwork");
        assert_eq!(scan(&conn, &cache).unwrap().added, 1);
        let title: String = conn
            .query_row("SELECT title FROM music_tracks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "夜に駆ける");
        let (artist, album): (String, String) = conn
            .query_row("SELECT artist,album FROM music_tracks", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(artist, "テストアーティスト");
        assert_eq!(album, "日本語のアルバム");
        assert_eq!(scan(&conn, &cache).unwrap().unchanged, 1);
        std::fs::create_dir_all(&cache).unwrap();
        let downloaded = crate::album_art::cache_path(&cache, &artist, &album);
        image::RgbImage::new(2, 2).save(&downloaded).unwrap();
        // Force a metadata reread: a cached downloaded cover must survive it.
        conn.execute("UPDATE music_tracks SET size_bytes=-1", [])
            .unwrap();
        assert_eq!(scan(&conn, &cache).unwrap().updated, 1);
        let artwork: String = conn
            .query_row("SELECT artwork FROM music_tracks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(artwork, downloaded.to_string_lossy());
        let moved = dir.join("fixture.backup");
        std::fs::rename(&path, &moved).unwrap();
        assert_eq!(scan(&conn, &cache).unwrap().missing, 1);
        std::fs::rename(moved, &path).unwrap();
        scan(&conn, &cache).unwrap();
        assert_eq!(
            conn.query_row("SELECT missing FROM music_tracks", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        // This directory was created above, beneath the OS test temporary folder.
        assert!(dir.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[tauri::command]
pub fn music_add_collection(db: tauri::State<Db>, name: String) -> Result<i64, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err("Enter a collection name between 1 and 100 characters.".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO music_collections(name) VALUES (?1)", [name])
        .map_err(|e| match e {
            rusqlite::Error::SqliteFailure(error, _)
                if error.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                "A collection with that name already exists.".to_string()
            }
            other => other.to_string(),
        })?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn music_move_root(db: tauri::State<Db>, id: i64, collection_id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if conn
        .execute(
            "UPDATE music_roots SET collection_id=?1 WHERE id=?2",
            params![collection_id, id],
        )
        .map_err(|e| e.to_string())?
        != 1
    {
        return Err("That music folder is no longer in the library.".into());
    }
    Ok(())
}

#[cfg(test)]
mod collection_tests {
    use super::*;

    #[test]
    fn existing_library_migrates_to_music_and_roots_can_change_collection() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for migration in crate::db::MIGRATIONS.iter().take(40) {
            conn.execute_batch(migration).unwrap();
        }
        conn.execute(
            "INSERT INTO music_roots(path) VALUES ('C:/Collections/Music')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO music_tracks(root_id,path,size_bytes,modified_at,title,artist,album_artist,album) VALUES (1,'song.mp3',1,1,'Title','Artist','Artist','Album')", []).unwrap();
        conn.execute_batch(crate::db::MIGRATIONS[40]).unwrap();
        let collection: String = conn.query_row("SELECT c.name FROM music_tracks t JOIN music_roots r ON t.root_id=r.id JOIN music_collections c ON c.id=r.collection_id",[],|row|row.get(0)).unwrap();
        assert_eq!(collection, "Music");
        conn.execute(
            "INSERT INTO music_collections(name) VALUES ('Christmas Music')",
            [],
        )
        .unwrap();
        assert!(conn
            .execute(
                "INSERT INTO music_collections(name) VALUES ('christmas music')",
                []
            )
            .is_err());
        conn.execute("UPDATE music_roots SET collection_id=2 WHERE id=1", [])
            .unwrap();
        let (id, path): (i64, String) = conn.query_row("SELECT r.collection_id,t.path FROM music_tracks t JOIN music_roots r ON t.root_id=r.id",[],|row|Ok((row.get(0)?,row.get(1)?))).unwrap();
        assert_eq!(id, 2);
        assert_eq!(path, "song.mp3");
        assert!(conn
            .execute("UPDATE music_roots SET collection_id=999 WHERE id=1", [])
            .is_err());
    }
}
