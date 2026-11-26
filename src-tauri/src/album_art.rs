//! Explicit, missing-only album cover lookup. Never edits the audio files.
use crate::{
    library::Db,
    music_art::{bytes, image_url, normalized, picture, REQUESTS},
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_http::reqwest;

static RUNNING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static STATUS: LazyLock<Mutex<AlbumProgress>> =
    LazyLock::new(|| Mutex::new(AlbumProgress::default()));
static MB_GATE: tokio::sync::Mutex<Option<Instant>> = tokio::sync::Mutex::const_new(None);
#[derive(Clone, Default, Serialize)]
pub struct AlbumProgress {
    kind: String,
    images: usize,
    running: bool,
    total: usize,
    checked: usize,
    found: usize,
    unmatched: usize,
    errors: usize,
    cancelled: bool,
    current: String,
    last_error: Option<String>,
}
struct JobGuard;
impl Drop for JobGuard {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::Release);
    }
}
#[derive(Default)]
struct Album {
    artist: String,
    title: String,
    ids: Vec<i64>,
    existing: Option<String>,
}
fn usable(value: &Option<String>) -> bool {
    value.as_ref().is_some_and(|p| Path::new(p).is_file())
}

fn candidates(conn: &rusqlite::Connection) -> Result<Vec<Album>, String> {
    let mut groups = BTreeMap::<(String, String), Album>::new();
    let mut stmt = conn
        .prepare("SELECT id,album_artist,album,artwork FROM music_tracks WHERE missing=0")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, artist, title, art) = row.map_err(|e| e.to_string())?;
        if artist.trim().is_empty()
            || title.trim().is_empty()
            || artist == "Unknown artist"
            || title == "Unknown album"
        {
            continue;
        }
        let album = groups
            .entry((artist.to_lowercase(), title.to_lowercase()))
            .or_insert_with(|| Album {
                artist,
                title,
                ..Album::default()
            });
        if usable(&art) {
            album.existing = art;
        } else {
            album.ids.push(id);
        }
    }
    Ok(groups.into_values().filter(|a| !a.ids.is_empty()).collect())
}
fn apply(conn: &rusqlite::Connection, album: &Album, path: &str) -> Result<usize, String> {
    let mut updated = 0;
    for id in &album.ids {
        let (artist, title, current): (String, String, Option<String>) = match conn.query_row(
            "SELECT album_artist,album,artwork FROM music_tracks WHERE id=?1 AND missing=0",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ) {
            Ok(value) => value,
            Err(rusqlite::Error::QueryReturnedNoRows) => continue,
            Err(e) => return Err(e.to_string()),
        };
        if artist.to_lowercase() != album.artist.to_lowercase()
            || title.to_lowercase() != album.title.to_lowercase()
        {
            continue;
        }
        if !usable(&current) {
            updated += conn
                .execute(
                    "UPDATE music_tracks SET artwork=?2 WHERE id=?1",
                    rusqlite::params![id, path],
                )
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(updated)
}
fn publish(app: &tauri::AppHandle, edit: impl FnOnce(&mut AlbumProgress)) {
    let value = {
        let mut s = STATUS.lock().unwrap_or_else(|e| e.into_inner());
        edit(&mut s);
        s.clone()
    };
    let _ = app.emit("music-album-art-progress", value);
}
#[tauri::command]
pub fn music_album_art_status() -> AlbumProgress {
    STATUS.lock().unwrap_or_else(|e| e.into_inner()).clone()
}
#[tauri::command]
pub fn music_cancel_album_art() {
    CANCEL.store(true, Ordering::Release);
}

fn album_match<'a>(
    data: &'a serde_json::Value,
    artist: &str,
    album: &str,
) -> Option<&'a serde_json::Value> {
    let list: Vec<_> = data
        .get("album")?
        .as_array()?
        .iter()
        .filter(|item| {
            item.get("strAlbum")
                .and_then(|v| v.as_str())
                .is_some_and(|v| normalized(v) == normalized(album))
                && item
                    .get("strArtist")
                    .and_then(|v| v.as_str())
                    .is_some_and(|v| normalized(v) == normalized(artist))
        })
        .collect();
    (list.len() == 1).then(|| list[0])
}
fn mb_match(data: &serde_json::Value, artist: &str, album: &str) -> Option<String> {
    let list: Vec<_> = data
        .get("release-groups")?
        .as_array()?
        .iter()
        .filter(|item| {
            item.get("title")
                .and_then(|v| v.as_str())
                .is_some_and(|v| normalized(v) == normalized(album))
                && item
                    .get("artist-credit")
                    .and_then(|v| v.as_array())
                    .is_some_and(|credit| {
                        credit.len() == 1
                            && [
                                credit[0].get("name"),
                                credit[0].get("artist").and_then(|v| v.get("name")),
                                credit[0].get("artist").and_then(|v| v.get("sort-name")),
                            ]
                            .into_iter()
                            .flatten()
                            .any(|v| {
                                v.as_str()
                                    .is_some_and(|v| normalized(v) == normalized(artist))
                            })
                    })
        })
        .collect();
    if list.len() != 1 {
        return None;
    }
    let id = list[0].get("id")?.as_str()?;
    (id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')).then(|| id.to_owned())
}
fn cover_host(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.host_str().is_some_and(|h| {
            h == "coverartarchive.org" || h == "archive.org" || h.ends_with(".archive.org")
        })
}
pub(super) fn cache_path(cache: &Path, artist: &str, album: &str) -> PathBuf {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    (normalized(artist), normalized(album)).hash(&mut hash);
    cache.join(format!("album-{:016x}.jpg", hash.finish()))
}
pub(super) fn cached_cover(cache: &Path, artist: &str, album: &str) -> Option<String> {
    let path = cache_path(cache, artist, album);
    path.is_file().then(|| path.to_string_lossy().into_owned())
}
async fn paced(gate: &tokio::sync::Mutex<Option<Instant>>, delay: u64) {
    let mut last = gate.lock().await;
    if let Some(time) = *last {
        tokio::time::sleep(Duration::from_millis(delay).saturating_sub(time.elapsed())).await;
    }
    *last = Some(Instant::now());
}
async fn lookup(dir: &Path, artist: &str, album: &str) -> Result<Option<String>, String> {
    let pictures = dir.join("artwork");
    std::fs::create_dir_all(&pictures).map_err(|e| e.to_string())?;
    let path = cache_path(&pictures, artist, album);
    if path.is_file() {
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    let client = crate::net::client(crate::net::Service::MusicMetadata)?
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("KinemaMediaPersonal/0.15.2 (personal desktop music artwork lookup)")
        .build()
        .map_err(|e| e.to_string())?;
    paced(&REQUESTS, 2100).await;
    if CANCEL.load(Ordering::Acquire) {
        return Ok(None);
    }
    let audio_db: Result<Option<String>, String> = async {
        let response = client
            .get("https://www.theaudiodb.com/api/v1/json/123/searchalbum.php")
            .query(&[("s", artist), ("a", album)])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let data: serde_json::Value = serde_json::from_slice(&bytes(response, 1024 * 1024).await?)
            .map_err(|e| e.to_string())?;
        if CANCEL.load(Ordering::Acquire) {
            return Ok(None);
        }
        if let Some(item) = album_match(&data, artist, album) {
            if let Some(url) =
                image_url(item, "strAlbumThumbHQ").or_else(|| image_url(item, "strAlbumThumb"))
            {
                return picture(&client, url, path.clone()).await.map(Some);
            }
        }
        Ok(None)
    }
    .await;
    if let Ok(Some(cover)) = audio_db {
        return Ok(Some(cover));
    }
    if CANCEL.load(Ordering::Acquire) {
        return Ok(None);
    }
    lookup_archive(&client, artist, album, path).await
}
pub(super) async fn pace_musicbrainz() {
    paced(&MB_GATE, 1200).await;
}

pub(super) async fn match_cover(
    dir: &Path, artist: &str, album: &str, release: &str, group: &str,
) -> Result<Option<String>, String> {
    let pictures = dir.join("artwork");
    std::fs::create_dir_all(&pictures).map_err(|e| e.to_string())?;
    let path = pictures.join(format!("match-cover-{release}.jpg"));
    if path.is_file() {
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    if let Some(cover) = cached_cover(&pictures, artist, album) {
        return Ok(Some(cover));
    }
    if let Some(cover) = archive_cover("release", release, path.clone()).await? {
        return Ok(Some(cover));
    }
    if group.len() != 36 || !group.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') {
        return Ok(None);
    }
    archive_cover("release-group", group, path).await
}

async fn lookup_archive(
    client: &reqwest::Client,
    artist: &str,
    album: &str,
    path: PathBuf,
) -> Result<Option<String>, String> {
    pace_musicbrainz().await;
    if CANCEL.load(Ordering::Acquire) {
        return Ok(None);
    }
    let escaped = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let query = format!(
        "releasegroup:\"{}\" AND artist:\"{}\"",
        escaped(album),
        escaped(artist)
    );
    let response = client
        .get("https://musicbrainz.org/ws/2/release-group/")
        .query(&[("query", query.as_str()), ("fmt", "json"), ("limit", "10")])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: serde_json::Value =
        serde_json::from_slice(&bytes(response, 1024 * 1024).await?).map_err(|e| e.to_string())?;
    if CANCEL.load(Ordering::Acquire) {
        return Ok(None);
    }
    let Some(id) = mb_match(&data, artist, album) else {
        return Ok(None);
    };
    archive_cover("release-group", &id, path).await
}

async fn archive_cover(kind: &str, id: &str, path: PathBuf) -> Result<Option<String>, String> {
    let covers = crate::net::client(crate::net::Service::MusicMetadata)?
        .timeout(Duration::from_secs(15))
        .user_agent("KinemaMediaPersonal/0.15.2 (personal desktop music artwork lookup)")
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && cover_host(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let url = reqwest::Url::parse(&format!(
        "https://coverartarchive.org/{kind}/{id}/front-500"
    ))
    .map_err(|e| e.to_string())?;
    let response = covers.get(url).send().await.map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    // Decode through the same bounded cache writer as artist art.
    let body = bytes(response, 8 * 1024 * 1024).await?;
    save_cover(body, path).await.map(Some)
}
async fn save_cover(body: Vec<u8>, path: PathBuf) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut reader = image::ImageReader::new(std::io::Cursor::new(body))
            .with_guessed_format()
            .map_err(|e| e.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        let image = reader.decode().map_err(|e| e.to_string())?;
        let temp = path.with_extension("part.jpg");
        image
            .thumbnail(1000, 1000)
            .to_rgb8()
            .save(&temp)
            .map_err(|e| e.to_string())?;
        std::fs::rename(temp, &path).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn music_find_album_art(app: tauri::AppHandle) -> Result<AlbumProgress, String> {
    if RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("An album artwork search is already running.".into());
    }
    let _guard = JobGuard;
    CANCEL.store(false, Ordering::Release);
    publish(&app, |s| {
        *s = AlbumProgress {
            kind: "albums".into(),
            running: true,
            ..AlbumProgress::default()
        }
    });
    let result: Result<(), String> = async {
        let dir = crate::data_dir(&app)?;
        let albums = {
            let db = app.state::<Db>();
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            candidates(&conn)?
        };
        publish(&app, |s| s.total = albums.len());
        for album in albums {
            if CANCEL.load(Ordering::Acquire) {
                break;
            }
            publish(&app, |s| {
                s.current = format!("{} — {}", album.artist, album.title)
            });
            let art = if let Some(ref path) = album.existing {
                Ok(Some(path.clone()))
            } else {
                lookup(&dir, &album.artist, &album.title).await
            };
            if CANCEL.load(Ordering::Acquire) {
                break;
            }
            let applied = match art {
                Ok(Some(path)) => {
                    let db = app.state::<Db>();
                    let conn = db.0.lock().map_err(|e| e.to_string())?;
                    apply(&conn, &album, &path).map(|n| n > 0)
                }
                Ok(None) => Ok(false),
                Err(e) => Err(e),
            };
            publish(&app, |s| {
                s.checked += 1;
                match applied {
                    Ok(true) => s.found += 1,
                    Ok(false) => s.unmatched += 1,
                    Err(e) => {
                        s.errors += 1;
                        s.last_error = Some(e);
                    }
                }
            });
        }
        Ok(())
    }
    .await;
    publish(&app, |s| {
        s.running = false;
        s.cancelled = CANCEL.load(Ordering::Acquire);
        s.current.clear();
        if let Err(ref e) = result {
            s.errors += 1;
            s.last_error = Some(e.clone());
        }
    });
    result?;
    Ok(music_album_art_status())
}

#[tauri::command]
pub async fn music_find_artist_art(app: tauri::AppHandle) -> Result<AlbumProgress, String> {
    if RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("An artwork search is already running.".into());
    }
    let _guard = JobGuard;
    CANCEL.store(false, Ordering::Release);
    publish(&app, |s| {
        *s = AlbumProgress {
            kind: "artists".into(),
            running: true,
            ..AlbumProgress::default()
        }
    });
    let result: Result<(),String> = async {
        let dir=crate::data_dir(&app)?;
        let artists: Vec<String>={
            let db=app.state::<Db>();let conn=db.0.lock().map_err(|e|e.to_string())?;
            let mut stmt=conn.prepare("SELECT album_artist FROM music_tracks WHERE missing=0 AND trim(album_artist)<>'' AND album_artist<>'Unknown artist' GROUP BY album_artist COLLATE NOCASE ORDER BY album_artist COLLATE NOCASE").map_err(|e|e.to_string())?;
            let names=stmt.query_map([],|r|r.get(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<String>,_>>().map_err(|e|e.to_string())?; names
        };
        publish(&app,|s|s.total=artists.len());
        for artist in artists {
            if CANCEL.load(Ordering::Acquire) {break;}
            publish(&app,|s|s.current=artist.clone());
            let art=crate::music_art::lookup_cancellable(dir.clone(),artist,true,Some(&CANCEL)).await;
            if CANCEL.load(Ordering::Acquire) {break;}
            publish(&app,|s| {s.checked+=1;match art {Ok(art) if !art.gallery.is_empty()=>{s.found+=1;s.images+=art.gallery.len();},Ok(_)=>s.unmatched+=1,Err(e)=>{s.errors+=1;s.last_error=Some(e);}}});
        }
        Ok(())
    }.await;
    publish(&app, |s| {
        s.running = false;
        s.cancelled = CANCEL.load(Ordering::Acquire);
        s.current.clear();
        if let Err(ref e) = result {
            s.errors += 1;
            s.last_error = Some(e.clone());
        }
    });
    result?;
    Ok(music_album_art_status())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_album_matching_rejects_other_artists_and_ambiguous_results() {
        let item = serde_json::json!({"strArtist":"杏里","strAlbum":"Timely!"});
        assert!(album_match(
            &serde_json::json!({"album":[item.clone()]}),
            "杏里",
            "Timely!"
        )
        .is_some());
        assert!(album_match(
            &serde_json::json!({"album":[item.clone()]}),
            "Other",
            "Timely!"
        )
        .is_none());
        assert!(album_match(
            &serde_json::json!({"album":[item.clone(),item]}),
            "杏里",
            "Timely!"
        )
        .is_none());
        let item = serde_json::json!({"id":"00000000-0000-0000-0000-000000000001","title":"Timely!","artist-credit":[{"name":"杏里"}]});
        assert!(mb_match(
            &serde_json::json!({"release-groups":[item.clone()]}),
            "杏里",
            "Timely!"
        )
        .is_some());
        assert!(mb_match(
            &serde_json::json!({"release-groups":[item.clone(),item]}),
            "杏里",
            "Timely!"
        )
        .is_none());
    }
    #[test]
    fn archive_redirects_are_https_and_provider_only() {
        for url in [
            "http://archive.org/a",
            "https://archive.org.evil.test/a",
            "https://evil.test/a",
            "https://archive.org:8443/a",
        ] {
            assert!(!cover_host(&reqwest::Url::parse(url).unwrap()));
        }
        assert!(cover_host(
            &reqwest::Url::parse("https://ia800100.us.archive.org/a.jpg").unwrap()
        ));
    }
    #[test]
    fn fills_only_missing_tracks_and_preserves_art_added_during_a_lookup() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        for migration in crate::db::MIGRATIONS {
            conn.execute_batch(migration).unwrap();
        }
        conn.execute("INSERT INTO music_roots(id,path) VALUES(1,'C:/Music')", [])
            .unwrap();
        let dir =
            std::env::temp_dir().join(format!("kinema-cover-test-{}", crate::util::now_secs()));
        std::fs::create_dir_all(&dir).unwrap();
        let existing = dir.join("existing.jpg");
        std::fs::write(&existing, b"existing").unwrap();
        for id in 1..=3 {
            conn.execute("INSERT INTO music_tracks(id,root_id,path,size_bytes,modified_at,title,artist,album_artist,album,artwork) VALUES(?1,1,?2,0,0,'Song','Artist','Artist','Album',?3)",rusqlite::params![id,format!("C:/Music/{id}.mp3"),if id==1{Some(existing.to_string_lossy().to_string())}else{None}]).unwrap();
        }
        let albums = candidates(&conn).unwrap();
        assert_eq!(albums.len(), 1);
        assert_eq!(albums[0].ids, vec![2, 3]);
        assert!(albums[0].existing.is_some());
        conn.execute(
            "UPDATE music_tracks SET artwork=?1 WHERE id=2",
            [existing.to_string_lossy().as_ref()],
        )
        .unwrap();
        assert_eq!(apply(&conn, &albums[0], "new-cover.jpg").unwrap(), 1);
        let untouched: String = conn
            .query_row("SELECT artwork FROM music_tracks WHERE id=2", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(untouched, existing.to_string_lossy());
        assert_ne!(
            cache_path(&dir, "Artist", "Album"),
            cache_path(&dir, "Other", "Album")
        );
    }
    #[test]
    #[ignore = "live cover request; run explicitly"]
    fn live_cover_download_and_cache() {
        tauri::async_runtime::block_on(async {
            let dir =
                std::env::temp_dir().join(format!("kinema-live-cover-{}", crate::util::now_secs()));
            let path = lookup(&dir, "Coldplay", "Parachutes")
                .await
                .unwrap()
                .expect("live cover");
            let image = image::open(&path).unwrap();
            assert!(image.width() > 100 && image.height() > 100);
            let _gate = REQUESTS.lock().await;
            assert_eq!(
                tokio::time::timeout(
                    Duration::from_millis(200),
                    lookup(&dir, "Coldplay", "Parachutes")
                )
                .await
                .unwrap()
                .unwrap(),
                Some(path)
            );
        });
    }
    #[test]
    #[ignore = "live MusicBrainz / Cover Art Archive request; run explicitly"]
    fn live_archive_download() {
        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir()
                .join(format!("kinema-live-archive-{}", crate::util::now_secs()));
            std::fs::create_dir_all(&dir).unwrap();
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent("KinemaMediaPersonal/0.15.2 (personal desktop music artwork lookup)")
                .build()
                .unwrap();
            let path = lookup_archive(&client, "Coldplay", "Parachutes", dir.join("cover.jpg"))
                .await
                .unwrap()
                .expect("archive cover");
            assert!(image::open(path).unwrap().width() > 100);
        });
    }
}
