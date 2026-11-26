//! MP3 edits are staged beside the originals before any file is replaced.
use crate::music::{self, MusicTrack};
use lofty::{
    config::WriteOptions,
    file::{FileType, TaggedFileExt},
    picture::{Picture, PictureType},
    tag::{items::Timestamp, Accessor, ItemKey, Tag, TagExt, TagType},
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct TagPatch {
    pub id: i64,
    #[serde(default)]
    pub embed_cover: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<String>,
    pub track: Option<String>,
    pub disc: Option<String>,
}

fn patch_text(tag: &mut Tag, key: ItemKey, value: &Option<String>) -> Result<(), String> {
    if let Some(value) = value {
        let value = value.trim();
        if value.len() > 4096 || value.contains('\0') {
            return Err(
                "Tag text must be at most 4096 bytes and contain no NUL characters.".into(),
            );
        }
        tag.remove_key(key);
        if !value.is_empty() && !tag.insert_text(key, value.into()) {
            return Err("An MP3 tag field could not be set.".into());
        }
    }
    Ok(())
}

fn number(value: &str, max: u16, label: &str) -> Result<Option<u32>, String> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    value
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|n| *n > 0 && *n <= max)
        .map(|n| Some(u32::from(n)))
        .ok_or_else(|| format!("{label} must be a whole number from 1 to {max}, or blank."))
}

fn update_tag(tag: &mut Tag, patch: &TagPatch, cover: Option<&Picture>) -> Result<(), String> {
    for (key, value) in [
        (ItemKey::TrackTitle, &patch.title),
        (ItemKey::TrackArtist, &patch.artist),
        (ItemKey::AlbumArtist, &patch.album_artist),
        (ItemKey::AlbumTitle, &patch.album),
        (ItemKey::Genre, &patch.genre),
    ] {
        patch_text(tag, key, value)?;
    }
    if let Some(value) = &patch.year {
        let year = number(value, 9999, "Year")?;
        let previous = tag.date();
        if previous.map(|date| u32::from(date.year)) != year || year.is_none() {
            tag.remove_date();
            tag.remove_key(ItemKey::Year);
            if let Some(year) = year {
                tag.set_date(Timestamp {
                    year: year as u16,
                    ..Timestamp::default()
                });
            }
        }
    }
    if let Some(value) = &patch.track {
        match number(value, 9999, "Track number")? {
            Some(n) => tag.set_track(n),
            None => tag.remove_track(),
        }
    }
    if let Some(value) = &patch.disc {
        match number(value, 9999, "Disc number")? {
            Some(n) => tag.set_disk(n),
            None => tag.remove_disk(),
        }
    }
    if let Some(cover) = cover {
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(cover.clone());
    }
    Ok(())
}

pub(super) fn read_cover(path: &Path) -> Result<Picture, String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|f| f.take(16 * 1024 * 1024 + 1).read_to_end(&mut bytes))
        .map_err(|e| format!("Cannot read cover image: {e}"))?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("Choose a cover image under 16 MB.".into());
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|e| format!("Cannot decode cover image: {e}"))?;
    let mut jpeg = Cursor::new(Vec::new());
    image
        .thumbnail(1200, 1200)
        .write_to(&mut jpeg, image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;
    jpeg.set_position(0);
    let mut cover = Picture::from_reader(&mut jpeg).map_err(|e| e.to_string())?;
    cover.set_pic_type(PictureType::CoverFront);
    Ok(cover)
}

pub(super) fn open_library(dir: &Path) -> Result<Connection, String> {
    let conn = Connection::open(dir.join("library.db")).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub(super) fn tracks_by_id(conn: &Connection, ids: &[i64]) -> Result<Vec<MusicTrack>, String> {
    if ids.is_empty() || ids.len() > 1000 {
        return Err("Select between 1 and 1000 MP3 tracks.".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut query = conn.prepare("SELECT id,path,title,artist,album_artist,album,track,disc,duration,genre,year,artwork,missing FROM music_tracks WHERE id=?1 AND missing=0")
        .map_err(|e| e.to_string())?;
    ids.iter()
        .map(|id| {
            if !seen.insert(id) {
                return Err("A track was selected twice.".into());
            }
            let track = query.query_row([id], music::track_row).map_err(|_| {
                "A selected track is no longer in the library. Rescan and try again.".to_string()
            })?;
            if !Path::new(&track.path)
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("mp3"))
            {
                return Err("Tag editing is available for MP3 files.".into());
            }
            Ok(track)
        })
        .collect()
}

struct Staged {
    original: PathBuf,
    directory: PathBuf,
    stamp: (i64, i64),
    keep_backup: bool,
}

impl Staged {
    fn backup(&self) -> PathBuf {
        self.directory.join("original.mp3")
    }
    fn edited(&self) -> PathBuf {
        self.directory.join("edited.mp3")
    }
}

impl Drop for Staged {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.edited());
        if !self.keep_backup {
            let _ = fs::remove_file(self.backup());
            let _ = fs::remove_dir(&self.directory);
        }
    }
}

fn staging_directory(parent: &Path) -> Result<PathBuf, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let directory = parent.join(format!(
        ".kinema-tag-{}-{now}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&directory).map_err(|e| e.to_string())?;
    Ok(directory)
}

fn stage(
    conn: &Connection,
    track: &MusicTrack,
    patch: &TagPatch,
    cover: Option<&Picture>,
) -> Result<Staged, String> {
    let path = PathBuf::from(&track.path);
    let expected = conn
        .query_row(
            "SELECT size_bytes,modified_at FROM music_tracks WHERE id=?1",
            [track.id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file()
        || metadata.permissions().readonly()
        || music::file_stamp(&metadata) != expected
    {
        return Err(format!(
            "{} changed on disk or is read-only. Rescan before saving.",
            path.display()
        ));
    }
    let parent = path.parent().ok_or("Track folder is missing.")?;
    let directory = staging_directory(parent)?;
    let staged = Staged {
        original: path,
        directory,
        stamp: expected,
        keep_backup: false,
    };
    fs::copy(&staged.original, staged.backup()).map_err(|e| e.to_string())?;
    let file = lofty::read_from_path(staged.backup()).map_err(|e| e.to_string())?;
    if file.file_type() != FileType::Mpeg {
        return Err(format!(
            "{} is not an MPEG audio file.",
            staged.original.display()
        ));
    }
    let mut tag = file.tag(TagType::Id3v2).cloned().unwrap_or_else(|| {
        let mut tag = file
            .first_tag()
            .cloned()
            .unwrap_or_else(|| Tag::new(TagType::Id3v2));
        tag.re_map(TagType::Id3v2);
        tag
    });
    update_tag(&mut tag, patch, cover)?;
    fs::copy(staged.backup(), staged.edited()).map_err(|e| e.to_string())?;
    tag.save_to_path(staged.edited(), WriteOptions::default())
        .map_err(|e| e.to_string())?;
    fs::OpenOptions::new()
        .write(true)
        .open(staged.edited())
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(staged)
}

fn replace_all(staged: Vec<Staged>) -> Result<(), String> {
    for file in &staged {
        let metadata = fs::symlink_metadata(&file.original).map_err(|e| e.to_string())?;
        if !metadata.is_file() || music::file_stamp(&metadata) != file.stamp {
            return Err(format!(
                "{} changed while saving. Rescan and try again.",
                file.original.display()
            ));
        }
    }
    let mut replaced: Vec<Staged> = Vec::new();
    for file in staged {
        if let Err(error) = fs::rename(file.edited(), &file.original) {
            let mut recovery = Vec::new();
            for mut item in replaced.into_iter().rev() {
                if fs::rename(item.backup(), &item.original).is_err() {
                    item.keep_backup = true;
                    recovery.push(format!(
                        "Restore {} from {}.",
                        item.original.display(),
                        item.backup().display()
                    ));
                }
            }
            return Err(format!(
                "Could not replace {}: {error}. {}",
                file.original.display(),
                recovery.join(" ")
            ));
        }
        replaced.push(file);
    }
    Ok(())
}

fn save(
    dir: &Path,
    patches: Vec<TagPatch>,
    cover: Option<String>,
) -> Result<music::ScanReport, String> {
    let conn = open_library(dir)?;
    let ids: Vec<_> = patches.iter().map(|patch| patch.id).collect();
    let tracks = tracks_by_id(&conn, &ids)?;
    let cover = cover
        .as_deref()
        .map(Path::new)
        .map(read_cover)
        .transpose()?;
    let staged = tracks
        .iter()
        .zip(&patches)
        .map(|(track, patch)| {
            stage(
                &conn,
                track,
                patch,
                cover.as_ref().filter(|_| patch.embed_cover),
            )
            .map_err(|e| format!("{}: {e}", track.title))
        })
        .collect::<Result<Vec<_>, _>>()?;
    // Invalidate even when the tag block retained its size and the filesystem
    // rounds the replacement's modification time to the old value.
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for id in ids {
        transaction
            .execute("UPDATE music_tracks SET size_bytes=-1 WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
    }
    replace_all(staged)?;
    transaction
        .commit()
        .map_err(|e| format!("Tags were saved. Rescan to update the library: {e}"))?;
    music::scan(&conn, &dir.join("artwork"))
        .map_err(|e| format!("Tags were saved. Rescan to update the library: {e}"))
}

#[tauri::command]
pub async fn music_save_tags(
    app: tauri::AppHandle,
    patches: Vec<TagPatch>,
    cover: Option<String>,
) -> Result<music::ScanReport, String> {
    let guard = music::exclusive()?;
    let dir = crate::data_dir(&app)?;
    crate::jobs::off_main(move || {
        let _guard = guard;
        save(&dir, patches, cover)
    })
    .await
}

#[tauri::command]
pub async fn music_preview_cover(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let dir = crate::data_dir(&app)?;
    crate::jobs::off_main(move || {
        let cover = read_cover(Path::new(&path))?;
        let cache = dir.join("artwork");
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        use std::hash::{Hash, Hasher};
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        cover.data().hash(&mut hash);
        let preview = cache.join(format!("music-tag-cover-preview-{:016x}.jpg", hash.finish()));
        fs::write(&preview, cover.data()).map_err(|e| e.to_string())?;
        Ok(preview.to_string_lossy().into_owned())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "Run with the disposable work/tag-fixture.mp3 generated by FFmpeg"]
    fn saves_album_and_embedded_art_while_preserving_each_title() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../work/tag-fixture.mp3");
        let dir = staging_directory(&std::env::temp_dir()).unwrap();
        let library = dir.join("library");
        fs::create_dir(&library).unwrap();
        let conn = open_library(&dir).unwrap();
        for migration in crate::db::MIGRATIONS {
            conn.execute_batch(migration).unwrap();
        }
        conn.execute(
            "INSERT INTO music_roots(path) VALUES (?1)",
            [library.to_string_lossy().as_ref()],
        )
        .unwrap();
        for index in 1..=2 {
            let file = library.join(format!("{index}.mp3"));
            fs::copy(&fixture, &file).unwrap();
            let mut tag = Tag::new(TagType::Id3v2);
            tag.set_title(format!("曲 {index}"));
            tag.set_artist("Old artist".into());
            tag.set_album("Old album".into());
            tag.set_track(index);
            tag.set_comment("Keep this comment".into());
            tag.save_to_path(&file, WriteOptions::default()).unwrap();
        }
        music::scan(&conn, &dir.join("artwork")).unwrap();
        let paths: Vec<_> = (1..=2)
            .map(|index| library.join(format!("{index}.mp3")))
            .collect();
        let originals: Vec<_> = paths.iter().map(|path| fs::read(path).unwrap()).collect();
        let cover = dir.join("cover.png");
        image::RgbImage::new(12, 12).save(&cover).unwrap();
        let patches: Vec<_> = (1..=2)
            .map(|id| TagPatch {
                id,
                album: Some("新しいアルバム".into()),
                album_artist: Some("New Artist".into()),
                year: Some("1998".into()),
                embed_cover: true,
                ..TagPatch::default()
            })
            .collect();
        let mut invalid = patches.clone();
        invalid[1].year = Some("wrong".into());
        assert!(save(&dir, invalid, None).is_err());
        for (path, original) in paths.iter().zip(originals) {
            assert_eq!(fs::read(path).unwrap(), original);
        }
        save(&dir, patches, Some(cover.to_string_lossy().into_owned())).unwrap();
        let tracks = tracks_by_id(&conn, &[1, 2]).unwrap();
        for (index, track) in tracks.iter().enumerate() {
            assert_eq!(track.title, format!("曲 {}", index + 1));
            assert_eq!(track.album, "新しいアルバム");
            assert_eq!(track.album_artist, "New Artist");
            assert_eq!(track.artist, "Old artist");
            assert_eq!(track.year, Some(1998));
            assert_eq!(track.track, index as u32 + 1);
            assert!(track.artwork.is_some());
            let mp3 = lofty::read_from_path(&track.path).unwrap();
            let tag = mp3.primary_tag().unwrap();
            assert_eq!(tag.comment().as_deref(), Some("Keep this comment"));
            assert_eq!(tag.pictures()[0].pic_type(), PictureType::CoverFront);
        }
        assert_eq!(fs::read_dir(&library).unwrap().count(), 2);
    }
}
