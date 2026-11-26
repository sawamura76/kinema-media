//! Folder-based movie and TV collections, independent of metadata franchise collections.
use crate::library::Db;
use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Serialize)]
pub struct VideoCollection {
    id: i64,
    name: String,
    kind: String,
}
#[derive(Serialize)]
pub struct RootCollection {
    root_id: i64,
    collection_id: i64,
}
#[derive(Serialize)]
pub struct TitleCollection {
    title_id: i64,
    collection_id: i64,
}
#[derive(Serialize)]
pub struct VideoCollections {
    collections: Vec<VideoCollection>,
    roots: Vec<RootCollection>,
    titles: Vec<TitleCollection>,
}

fn read_collections(conn: &Connection) -> Result<VideoCollections, String> {
    let mut query = conn
        .prepare("SELECT id,name,kind FROM video_collections ORDER BY id")
        .map_err(|e| e.to_string())?;
    let collections = query
        .query_map([], |r| {
            Ok(VideoCollection {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let mut query=conn.prepare("SELECT r.id,COALESCE(c.collection_id,CASE r.kind WHEN 'movies' THEN 1 ELSE 2 END) FROM library_roots r LEFT JOIN video_collection_roots c ON c.root_id=r.id WHERE r.kind IN ('movies','tv')").map_err(|e|e.to_string())?;
    let roots = query
        .query_map([], |r| {
            Ok(RootCollection {
                root_id: r.get(0)?,
                collection_id: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let mut query=conn.prepare("SELECT DISTINCT m.title_id,COALESCE(c.collection_id,CASE r.kind WHEN 'movies' THEN 1 ELSE 2 END) FROM media_files m JOIN library_roots r ON r.id=m.root_id LEFT JOIN video_collection_roots c ON c.root_id=r.id WHERE m.title_id IS NOT NULL AND m.missing=0 AND r.kind IN ('movies','tv')").map_err(|e|e.to_string())?;
    let titles = query
        .query_map([], |r| {
            Ok(TitleCollection {
                title_id: r.get(0)?,
                collection_id: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(VideoCollections {
        collections,
        roots,
        titles,
    })
}
#[tauri::command]
pub fn video_collections(db: tauri::State<Db>) -> Result<VideoCollections, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    read_collections(&conn)
}
fn create_collection(conn: &Connection, name: &str, kind: &str) -> Result<i64, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 || name.contains('\0') {
        return Err("Enter a collection name of 1–100 characters.".into());
    }
    if !matches!(kind, "movies" | "tv") {
        return Err("Choose Movies or TV.".into());
    }
    conn.execute(
        "INSERT INTO video_collections(name,kind) VALUES (?1,?2)",
        params![name, kind],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            "A collection with that name already exists.".into()
        } else {
            e.to_string()
        }
    })?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
pub fn video_add_collection(
    db: tauri::State<Db>,
    name: String,
    kind: String,
) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    create_collection(&conn, &name, &kind)
}
fn assign_root(conn: &Connection, root_id: i64, collection_id: i64) -> Result<(), String> {
    let matches:i64=conn.query_row("SELECT COUNT(*) FROM library_roots r JOIN video_collections c ON c.kind=r.kind WHERE r.id=?1 AND c.id=?2",params![root_id,collection_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if matches != 1 {
        return Err("Choose a collection matching this folder's Movies or TV type.".into());
    }
    conn.execute("INSERT INTO video_collection_roots(root_id,collection_id) VALUES (?1,?2) ON CONFLICT(root_id) DO UPDATE SET collection_id=excluded.collection_id",params![root_id,collection_id]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn video_assign_root(
    db: tauri::State<Db>,
    root_id: i64,
    collection_id: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assign_root(&conn, root_id, collection_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_folder_assignment_keep_movies_and_tv_separate() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute("INSERT INTO library_roots(id,path,kind,added_at) VALUES(1,'C:/Movies','movies',1),(2,'C:/TV','tv',1)",[]).unwrap();
        let data = read_collections(&conn).unwrap();
        assert_eq!(
            data.roots
                .iter()
                .map(|r| r.collection_id)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        let christmas = create_collection(&conn, "Christmas movies", "movies").unwrap();
        let anime = create_collection(&conn, "Anime TV", "tv").unwrap();
        assign_root(&conn, 1, christmas).unwrap();
        assign_root(&conn, 2, anime).unwrap();
        assert!(assign_root(&conn, 1, anime).is_err());
        assert!(create_collection(&conn, "christmas MOVIES", "movies").is_err());
        assert!(create_collection(&conn, "  ", "tv").is_err());
        conn.execute("DELETE FROM library_roots WHERE id=1", [])
            .unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM video_collection_roots WHERE root_id=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn schema_42_upgrade_preserves_matches_playback_and_default_membership() {
        let conn = Connection::open_in_memory().unwrap();
        for migration in crate::db::MIGRATIONS.iter().take(42) {
            conn.execute_batch(migration).unwrap();
        }
        conn.execute_batch("PRAGMA user_version=42;
          INSERT INTO library_roots(id,path,kind,added_at) VALUES(1,'C:/Movies','movies',0),(2,'C:/More Movies','movies',0);
          INSERT INTO titles(id,kind,provider,provider_id,title,fetched_at) VALUES(1,'movie','tmdb','test','Test movie',0);
          INSERT INTO media_files(id,root_id,path,parent_dir,file_name,extension,size_bytes,modified_at,first_seen_at,last_seen_at,title_id) VALUES
          (1,1,'C:/Movies/a.mp4','C:/Movies','a.mp4','mp4',1,0,0,0,1),
          (2,2,'C:/More Movies/a.mp4','C:/More Movies','a.mp4','mp4',1,0,0,0,1);
          INSERT INTO playback_state(file_id,position_secs,completed,updated_at) VALUES(1,123,0,0);").unwrap();
        crate::db::migrate(&conn).unwrap();
        assert_eq!(read_collections(&conn).unwrap().titles.len(), 1);
        let id = create_collection(&conn, "Christmas movies", "movies").unwrap();
        assign_root(&conn, 2, id).unwrap();
        let data = read_collections(&conn).unwrap();
        assert_eq!(data.titles.len(), 2); // One title can occur in both folder collections.
        conn.execute("UPDATE media_files SET missing=1 WHERE id=2", [])
            .unwrap();
        assert_eq!(read_collections(&conn).unwrap().titles.len(), 1);
        assert_eq!(
            conn.query_row(
                "SELECT position_secs FROM playback_state WHERE file_id=1",
                [],
                |r| r.get::<_, f64>(0)
            )
            .unwrap(),
            123.0
        );
    }
}
