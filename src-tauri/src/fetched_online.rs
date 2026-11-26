//! "Remove pictures and details fetched online" (Settings → Privacy, with
//! Keep everything on this computer on; PRIVATE-MODE.md §2, wording a).
//!
//! Switching the mode on stops lookups from then on; what was fetched before
//! stays until this is pressed. It removes what came from the internet:
//! downloaded posters, backdrops, logos and stills, plots, cast, studios,
//! trailers, age ratings, "More like this", Rotten Tomatoes scores and
//! TheIntroDB/IntroDB answers. Kept: each title's name, year and ids (so its
//! files, what was watched, resume points and My list stay where they are),
//! episode names, pictures found beside the files, and IMDb's ratings (a file
//! the mode still allows). Every title's details are marked as never fetched,
//! so going back online fetches them again.

use crate::library::Db;
use crate::util::to_string_err;
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Removed {
    /// Titles whose online details were removed.
    pub titles: usize,
    /// Downloaded picture files deleted.
    pub pictures: usize,
    pub bytes: u64,
}

/// Titles whose details came from a service online (not IMDb's list on this
/// computer, not a title kept by its file name).
const ONLINE: &str = "provider NOT IN ('imdb', 'local')";

/// The database part; hands back the picture files to delete.
fn clear(conn: &Connection) -> rusqlite::Result<(usize, Vec<(PathBuf, u64)>)> {
    let tx = conn.unchecked_transaction()?;
    let files = {
        let mut stmt =
            tx.prepare("SELECT local_path, bytes FROM artwork_cache WHERE url LIKE 'http%'")?;
        let rows = stmt.query_map([], |r| Ok((PathBuf::from(r.get::<_, String>(0)?), r.get::<_, i64>(1)?)))?;
        rows.filter_map(Result::ok).map(|(p, b)| (p, b.max(0) as u64)).collect::<Vec<_>>()
    };
    tx.execute("DELETE FROM artwork_cache WHERE url LIKE 'http%'", [])?;
    let web = |col: &str| format!("{col} = CASE WHEN {col} LIKE 'http%' THEN NULL ELSE {col} END");
    let titles = tx.execute(
        &format!(
            "UPDATE titles SET {}, {}, {}, overview = NULL, trailer_key = NULL,
                    trailer_site = NULL, similar_ids = NULL, directors = NULL, writers = NULL,
                    certification = NULL, certifications = NULL, collection_id = NULL,
                    collection_name = NULL, show_status = NULL, next_air_date = NULL,
                    next_air_season = NULL, next_air_episode = NULL, fetched_at = 0
              WHERE {ONLINE}",
            web("poster_url"),
            web("backdrop_url"),
            web("logo_url")
        ),
        [],
    )?;
    tx.execute(
        &format!(
            "UPDATE episodes SET overview = NULL, {}
              WHERE title_id IN (SELECT id FROM titles WHERE {ONLINE})",
            web("still_url")
        ),
        [],
    )?;
    tx.execute(&format!("DELETE FROM people WHERE title_id IN (SELECT id FROM titles WHERE {ONLINE})"), [])?;
    tx.execute(&format!("DELETE FROM studios WHERE title_id IN (SELECT id FROM titles WHERE {ONLINE})"), [])?;
    tx.execute(&format!("DELETE FROM season_art WHERE title_id IN (SELECT id FROM titles WHERE {ONLINE})"), [])?;
    tx.execute("DELETE FROM person_info", [])?;
    tx.execute("DELETE FROM omdb_scores", [])?;
    tx.execute("DELETE FROM remote_skip_answers", [])?;
    tx.execute("DELETE FROM poster_choice WHERE url LIKE 'http%'", [])?;
    tx.commit()?;
    Ok((titles, files))
}

#[tauri::command]
pub async fn remove_fetched_online(app: tauri::AppHandle) -> Result<Removed, String> {
    let (titles, files) = {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(to_string_err)?;
        clear(&conn).map_err(to_string_err)?
    };
    let thumbs = crate::data_dir(&app)?.join("artwork").join(crate::thumbs::FOLDER);
    let removed = crate::jobs::off_main(move || {
        let mut removed = Removed { titles, ..Default::default() };
        for (path, bytes) in files {
            if std::fs::remove_file(&path).is_ok() {
                removed.pictures += 1;
                removed.bytes += bytes;
            }
        }
        // Small copies made from those; made again from what is left when seen.
        let _ = std::fs::remove_dir_all(thumbs);
        Ok(removed)
    })
    .await?;
    crate::log!(
        "privacy: removed what was fetched online: {} titles, {} pictures ({} bytes)",
        removed.titles,
        removed.pictures,
        removed.bytes
    );
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn online_details_go_and_what_is_yours_stays() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO titles (id, kind, provider, provider_id, imdb_id, title, year, overview,
                                 poster_url, backdrop_url, fetched_at)
             VALUES (1, 'movie', 'tmdb', '603', 'tt0133093', 'A film', 1999, 'Plot',
                     'https://image.tmdb.org/t/p/original/a.jpg', 'C:\\films\\fanart.jpg', 100),
                    (2, 'movie', 'imdb', 'tt1', 'tt1', 'Kept here', 2001, NULL, NULL, NULL, 100);
             INSERT INTO people (title_id, name, ord) VALUES (1, 'An actor', 0);
             INSERT INTO artwork_cache (url, local_path, bytes, fetched_at)
             VALUES ('https://image.tmdb.org/t/p/original/a.jpg', 'nowhere/a.jpg', 10, 1),
                    ('local:fanart', 'nowhere/local-b.jpg', 10, 1);
             INSERT INTO omdb_scores (imdb_id, tomatometer, fetched_at) VALUES ('tt0133093', 88, 1);",
        )
        .unwrap();
        let (titles, files) = clear(&conn).unwrap();
        assert_eq!(titles, 1);
        assert_eq!(files.len(), 1);
        let row: (String, Option<String>, Option<String>, Option<String>, i64) = conn
            .query_row(
                "SELECT title, overview, poster_url, backdrop_url, fetched_at FROM titles WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!(row, ("A film".into(), None, None, Some("C:\\films\\fanart.jpg".into()), 0));
        let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM people"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM omdb_scores"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM artwork_cache"), 1);
        assert_eq!(count("SELECT fetched_at FROM titles WHERE id = 2"), 100);
    }
}
