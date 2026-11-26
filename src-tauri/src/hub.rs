//! Local collection backgrounds and explicit game/app shortcuts.
use crate::library::Db;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[derive(Deserialize)]
pub struct CollectionPreferences {
    pub id: i64,
    pub default_sort: String,
    pub background_kind: String,
    pub background_path: String,
}

pub fn valid_sort(value: &str) -> bool {
    matches!(value, "artist" | "album" | "year" | "genre" | "title")
}

#[tauri::command]
pub fn music_collection_preferences(
    db: tauri::State<Db>,
    preferences: CollectionPreferences,
) -> Result<(), String> {
    if !valid_sort(&preferences.default_sort)
        || !matches!(
            preferences.background_kind.as_str(),
            "artist" | "album" | "images" | "video"
        )
    {
        return Err("Choose a supported sort order and background.".into());
    }
    let path = preferences.background_path.trim();
    if matches!(preferences.background_kind.as_str(), "images" | "video") && path.is_empty() {
        return Err("Choose a background folder or video.".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let changed = conn.execute(
        "UPDATE music_collections SET default_sort=?1,background_kind=?2,background_path=?3 WHERE id=?4",
        params![preferences.default_sort,preferences.background_kind,path,preferences.id],
    ).map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("That collection is no longer available.".into());
    }
    Ok(())
}

#[derive(Serialize)]
pub struct BackgroundMedia {
    images: Vec<String>,
    video: Option<String>,
}

#[tauri::command]
pub async fn music_collection_media(
    app: tauri::AppHandle,
    id: i64,
) -> Result<BackgroundMedia, String> {
    let dir = crate::data_dir(&app)?;
    let (kind, path) = crate::jobs::off_main(move || {
        let conn = crate::music_tags::open_library(&dir)?;
        conn.query_row(
            "SELECT background_kind,background_path FROM music_collections WHERE id=?1",
            [id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())
    })
    .await?;
    visualization_media(app, kind, path).await
}

#[tauri::command]
pub async fn visualization_media(app: tauri::AppHandle, kind: String, path: String) -> Result<BackgroundMedia, String> {
    if !matches!(kind.as_str(), "images" | "video") { return Err("Choose images or video.".into()); }
    let scope = app.asset_protocol_scope();
    crate::jobs::off_main(move || {
        let mut media = BackgroundMedia {
            images: Vec::new(),
            video: None,
        };
        if kind == "images" {
            let directory = std::fs::canonicalize(&path)
                .map_err(|e| format!("Background folder is unavailable: {e}"))?;
            if !directory.is_dir() {
                return Err("Choose an image folder.".into());
            }
            for entry in walkdir::WalkDir::new(&directory).follow_links(false) {
                let entry = entry.map_err(|e| e.to_string())?;
                if !entry.file_type().is_file() {
                    continue;
                }
                let ext = entry
                    .path()
                    .extension()
                    .and_then(|v| v.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if ["jpg", "jpeg", "png", "webp", "bmp", "gif", "avif"].contains(&ext.as_str()) {
                    scope.allow_file(entry.path()).map_err(|e| e.to_string())?;
                    media
                        .images
                        .push(entry.path().to_string_lossy().into_owned());
                    if media.images.len() >= 2000 {
                        break;
                    }
                }
            }
            media.images.sort();
            if media.images.is_empty() {
                return Err("No supported images were found in that folder.".into());
            }
        } else if kind == "video" {
            let file = std::fs::canonicalize(&path)
                .map_err(|e| format!("Background video is unavailable: {e}"))?;
            let ext = file
                .extension()
                .and_then(|v| v.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !file.is_file() || !["mp4", "webm", "m4v"].contains(&ext.as_str()) {
                return Err("Choose an MP4, M4V or WebM background video.".into());
            }
            scope.allow_file(&file).map_err(|e| e.to_string())?;
            media.video = Some(file.to_string_lossy().into_owned());
        }
        Ok(media)
    })
    .await
}

#[derive(Clone, Deserialize, Serialize)]
pub struct GameShortcut {
    pub id: Option<i64>,
    pub title: String,
    pub target: String,
    pub arguments: Vec<String>,
    pub working_directory: String,
    pub artwork: Option<String>,
    pub platform: String,
    pub kind: String,
}

fn validate(shortcut: &GameShortcut) -> Result<(), String> {
    if shortcut.title.trim().is_empty() || shortcut.title.chars().count() > 150 {
        return Err("Enter a title up to 150 characters.".into());
    }
    if !matches!(shortcut.kind.as_str(), "game" | "app") {
        return Err("Choose Game or App.".into());
    }
    if shortcut.arguments.len() > 100
        || shortcut
            .arguments
            .iter()
            .any(|a| a.contains('\0') || a.len() > 8192)
    {
        return Err("The launch arguments are too long.".into());
    }
    if let Ok(url) = tauri_plugin_http::reqwest::Url::parse(&shortcut.target) {
        if matches!(
            url.scheme(),
            "steam" | "com.epicgames.launcher" | "goggalaxy" | "ms-xbox" | "https"
        ) {
            if !shortcut.arguments.is_empty() || !shortcut.working_directory.is_empty() {
                return Err("Use an executable for arguments or a working directory.".into());
            }
            return Ok(());
        }
    }
    let file = Path::new(&shortcut.target);
    let ext = file
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !file.is_file() || !["exe", "lnk", "url"].contains(&ext.as_str()) {
        return Err("Choose an EXE, Windows shortcut, or supported game launch link.".into());
    }
    if ext != "exe" && (!shortcut.arguments.is_empty() || !shortcut.working_directory.is_empty()) {
        return Err("Save arguments in the Windows shortcut, or choose the executable.".into());
    }
    if !shortcut.working_directory.is_empty() && !Path::new(&shortcut.working_directory).is_dir() {
        return Err("The working directory is unavailable.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn game_shortcuts(db: tauri::State<Db>) -> Result<Vec<GameShortcut>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut query = conn.prepare("SELECT id,title,target,arguments,working_directory,artwork,platform,kind FROM game_shortcuts ORDER BY title COLLATE NOCASE").map_err(|e|e.to_string())?;
    let rows = query
        .query_map([], |row| {
            let args: String = row.get(3)?;
            Ok(GameShortcut {
                id: Some(row.get(0)?),
                title: row.get(1)?,
                target: row.get(2)?,
                arguments: serde_json::from_str(&args).unwrap_or_default(),
                working_directory: row.get(4)?,
                artwork: row.get(5)?,
                platform: row.get(6)?,
                kind: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn game_save(app: tauri::AppHandle, shortcut: GameShortcut) -> Result<i64, String> {
    let dir = crate::data_dir(&app)?;
    crate::jobs::off_main(move || {
        let mut shortcut = shortcut;
        shortcut.title = shortcut.title.trim().to_owned();
        shortcut.target = shortcut.target.trim().to_owned();
        validate(&shortcut)?;
        if let Some(art) = &shortcut.artwork {
            let image = crate::music_tags::read_cover(Path::new(art))?;
            use std::hash::{Hash, Hasher};
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            image.data().hash(&mut hash);
            let cache = dir.join("artwork");
            std::fs::create_dir_all(&cache).map_err(|e|e.to_string())?;
            let dest = cache.join(format!("game-{:016x}.jpg",hash.finish()));
            if !dest.is_file() { std::fs::write(&dest, image.data()).map_err(|e|e.to_string())?; }
            shortcut.artwork = Some(dest.to_string_lossy().into_owned());
        }
        let conn = crate::music_tags::open_library(&dir)?;
        let args = serde_json::to_string(&shortcut.arguments).map_err(|e|e.to_string())?;
        if let Some(id) = shortcut.id {
            if conn.execute("UPDATE game_shortcuts SET title=?1,target=?2,arguments=?3,working_directory=?4,artwork=?5,platform=?6,kind=?7 WHERE id=?8",
                params![shortcut.title,shortcut.target,args,shortcut.working_directory,shortcut.artwork,shortcut.platform,shortcut.kind,id]).map_err(|e|e.to_string())? != 1 {
                return Err("That shortcut was removed.".into());
            }
            Ok(id)
        } else {
            conn.execute("INSERT INTO game_shortcuts(title,target,arguments,working_directory,artwork,platform,kind) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![shortcut.title,shortcut.target,args,shortcut.working_directory,shortcut.artwork,shortcut.platform,shortcut.kind]).map_err(|e|e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }).await
}

#[tauri::command]
pub fn game_remove(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .execute("DELETE FROM game_shortcuts WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn spawn_executable(entry: &GameShortcut) -> Result<std::process::Child, String> {
    let mut command = std::process::Command::new(&entry.target);
    command.args(&entry.arguments);
    if !entry.working_directory.is_empty() {
        command.current_dir(&entry.working_directory);
    } else if let Some(parent) = Path::new(&entry.target).parent() {
        command.current_dir(parent);
    }
    command.spawn().map_err(|error| format!("Could not launch {}: {error}", entry.title))
}

#[tauri::command]
pub async fn game_launch(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let dir = crate::data_dir(&app)?;
    let entry = crate::jobs::off_main(move || {
        let conn = crate::music_tags::open_library(&dir)?;
        conn.query_row(
            "SELECT title,target,arguments,working_directory,kind FROM game_shortcuts WHERE id=?1",
            [id],
            |row| {
                let args: String = row.get(2)?;
                Ok(GameShortcut {
                    id: Some(id),
                    title: row.get(0)?,
                    target: row.get(1)?,
                    arguments: serde_json::from_str(&args).unwrap_or_default(),
                    working_directory: row.get(3)?,
                    artwork: None,
                    platform: String::new(),
                    kind: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "That shortcut was removed.".to_string())
    })
    .await?;
    let app_handle = app.clone();
    crate::jobs::off_main(move || {
        validate(&entry)?;
        if Path::new(&entry.target).is_file() && Path::new(&entry.target)
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        {
            spawn_executable(&entry)?;
        } else if Path::new(&entry.target).is_file() {
            app_handle
                .opener()
                .open_path(&entry.target, None::<&str>)
                .map_err(|e| e.to_string())?;
        } else {
            app_handle
                .opener()
                .open_url(&entry.target, None::<&str>)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn game(target: &str) -> GameShortcut {
        GameShortcut { id: None, title: "Test".into(), target:target.into(), arguments:Vec::new(),working_directory:String::new(),artwork:None,platform:String::new(),kind:"game".into() }
    }
    #[test]
    fn launch_targets_require_supported_explicit_shortcuts() {
        assert!(validate(&game("steam://rungameid/123")).is_ok());
        assert!(validate(&game("https://example.com/game")).is_ok());
        assert!(validate(&game("javascript:alert(1)")).is_err());
        assert!(validate(&game("C:/missing/game.exe")).is_err());
        let mut invalid = game("steam://rungameid/123");
        invalid.arguments.push("extra".into());
        assert!(validate(&invalid).is_err());
    }
    #[test]
    #[ignore = "Run explicitly with KINEMA_TEST_GAME_EXE pointing to the local probe fixture"]
    fn executable_launch_preserves_arguments_and_working_directory() {
        let target = std::env::var("KINEMA_TEST_GAME_EXE").unwrap();
        let directory = std::env::temp_dir().join(format!("kinema-game-probe-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let marker = directory.join("result.txt");
        let mut entry = game(&target);
        entry.arguments = vec![marker.to_string_lossy().into_owned(), "argument with spaces".into()];
        entry.working_directory = directory.to_string_lossy().into_owned();
        validate(&entry).unwrap();
        let status = spawn_executable(&entry).unwrap().wait().unwrap();
        assert!(status.success());
        let content = std::fs::read_to_string(marker).unwrap();
        assert!(content.contains("argument with spaces"));
        assert!(content.contains(&directory.to_string_lossy().to_string()));
    }

    #[test]
    fn collections_and_games_upgrade_without_changing_existing_roots() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        for migration in crate::db::MIGRATIONS.iter().take(41) { conn.execute_batch(migration).unwrap(); }
        conn.execute("INSERT INTO music_roots(path) VALUES ('C:/Music')",[]).unwrap();
        conn.execute_batch(crate::db::MIGRATIONS[41]).unwrap();
        let (sort,kind,path):(String,String,String)=conn.query_row(
            "SELECT default_sort,background_kind,r.path FROM music_collections c JOIN music_roots r ON r.collection_id=c.id",
            [],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
        assert_eq!((sort.as_str(),kind.as_str(),path.as_str()),("artist","artist","C:/Music"));
        conn.execute("INSERT INTO game_shortcuts(title,target) VALUES ('Test','steam://rungameid/123')",[]).unwrap();
        assert!(valid_sort("genre"));
        assert!(!valid_sort("random"));
    }
}
