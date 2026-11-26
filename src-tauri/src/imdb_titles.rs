//! IMDb's list of titles, kept on this computer for matching without lookups.
//!
//! "Keep everything on this computer" (PRIVATE-MODE.md §2) matches names
//! here instead of asking TMDB: against `title.basics.tsv.gz`, the list of
//! every title IMDb publishes for personal, non-commercial use on the same
//! host as the ratings file (`imdb.rs`). Nothing about the library is sent:
//! the same two files are downloaded whatever the library holds.
//!
//! The file is about 230 MB and 13 million rows. It is never stored: the
//! download is read as it arrives, through gunzip, and only films, TV films,
//! series and mini-series with at least ten IMDb votes are kept (about half a
//! million; the rest are mostly episodes and empty stubs, which made wrong
//! matches in the design's dry run). Their votes come from the ratings file,
//! read the same way first. What is kept goes into a database of its own,
//! `imdb-titles.db` beside the library (76 MB in November 2026), with a word index for
//! names that are only part of a file's name.
//!
//! Built into a `.part` file and swapped in only when complete: a broken
//! download leaves the list that was there, or none, never half a list.
//! Fetched again at most once a month, and only while the setting allowing it
//! is on (`ALLOWED_KEY`; Settings → Privacy, P2b).

use crate::util::to_string_err;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::time::Duration;

const BASICS_URL: &str = "https://datasets.imdbws.com/title.basics.tsv.gz";

/// The database's file name, in the data folder beside `library.db`.
pub const FILE_NAME: &str = "imdb-titles.db";

/// Library setting: "1" when the list may be downloaded. Off unless turned on.
pub const ALLOWED_KEY: &str = "imdb_titles_allowed";

/// Fewer votes than this is left out: almost all are stubs (no year, no
/// runtime) that only ever make wrong matches. The owner's choice 1a.
const MIN_VOTES: u32 = 10;

const DAY: i64 = 24 * 60 * 60;
/// IMDb adds titles daily; a month-old list still knows almost everything.
const MAX_AGE: i64 = 30 * DAY;

/// A real list has about half a million rows. Far fewer means IMDb's file
/// changed shape or was cut short, and the old list is better than that one.
const MIN_ROWS_REAL: usize = 100_000;

/// 230 MB on a slow line.
const TIMEOUT: Duration = Duration::from_secs(60 * 60);

// ---------------------------------------------------------------------------
// Names, the way both the list and a file's name are looked up.
// ---------------------------------------------------------------------------

/// Accented Latin letters to their plain letter — what NFKD and dropping the
/// marks does in `score.ts`, for the letters film names use. The scorer
/// compares the names again with its own rules; this only finds them.
fn fold(c: char) -> Option<&'static str> {
    const FROM: &str = "àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľŀłñńņňòóôõöøōŏőŕŗřśŝşšţťŧùúûüũūŭůűųŵýÿŷźżž";
    const TO: &[&str] = &[
        "a", "a", "a", "a", "a", "a", "a", "a", "a", "c", "c", "c", "c", "c", "d", "d", "e", "e",
        "e", "e", "e", "e", "e", "e", "e", "g", "g", "g", "g", "h", "h", "i", "i", "i", "i", "i",
        "i", "i", "i", "i", "j", "k", "l", "l", "l", "l", "l", "n", "n", "n", "n", "o", "o", "o",
        "o", "o", "o", "o", "o", "o", "r", "r", "r", "s", "s", "s", "s", "t", "t", "t", "u", "u",
        "u", "u", "u", "u", "u", "u", "u", "u", "w", "y", "y", "y", "z", "z", "z",
    ];
    match c {
        'æ' => Some("ae"),
        'œ' => Some("oe"),
        'ß' => Some("ss"),
        _ => FROM.chars().position(|f| f == c).map(|i| TO[i]),
    }
}

/// A name for finding: lower case, accents off, `&` as "and", apostrophes
/// dropped ("ocean's" is "oceans"), every other sign a space, a leading
/// article dropped.
pub fn normalise(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for c in raw.chars().flat_map(char::to_lowercase) {
        if matches!(c, '\'' | '’' | '‘' | '`' | 'ʼ') {
            continue;
        }
        if c == '&' {
            out.push_str(" and ");
        } else if let Some(plain) = fold(c) {
            out.push_str(plain);
        } else if c.is_alphanumeric() {
            out.push(c);
        } else if ('\u{300}'..='\u{36f}').contains(&c) {
            // A combining accent: the letter before it stays plain.
        } else {
            out.push(' ');
        }
    }
    let words: Vec<&str> = out.split_whitespace().collect();
    let start = usize::from(words.len() > 1 && matches!(words[0], "the" | "a" | "an"));
    words[start..].join(" ")
}

// ---------------------------------------------------------------------------
// Building the list.
// ---------------------------------------------------------------------------

/// One kept rating: id number, rating, votes. Sorted by id, searched by halves
/// — about 12 bytes a title, so the ratings of every title IMDb has fit in a
/// few megabytes on a TV box.
type Votes = Vec<(u32, f32, u32)>;

/// The number in `tt0133093`.
fn id_number(tconst: &str) -> Option<u32> {
    tconst.strip_prefix("tt")?.parse().ok()
}

fn unknown(field: &str) -> Option<&str> {
    (field != "\\N" && !field.is_empty()).then_some(field)
}

/// Ratings with at least `MIN_VOTES` votes, from `title.ratings.tsv.gz`.
fn read_votes<R: Read>(gzipped: R) -> std::io::Result<Votes> {
    let reader = BufReader::with_capacity(1 << 16, flate2::read::MultiGzDecoder::new(gzipped));
    let mut kept = Votes::new();
    for line in reader.lines() {
        let line = line?;
        let mut f = line.split('\t');
        let (Some(id), Some(rating), Some(votes)) = (f.next(), f.next(), f.next()) else {
            continue;
        };
        let (Some(id), Ok(rating), Ok(votes)) =
            (id_number(id), rating.parse::<f32>(), votes.trim().parse::<u32>())
        else {
            continue;
        };
        if votes >= MIN_VOTES {
            kept.push((id, rating, votes));
        }
    }
    kept.sort_unstable_by_key(|v| v.0);
    Ok(kept)
}

const SCHEMA: &str = "
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE titles (
        id        INTEGER PRIMARY KEY,   -- the number of tt…
        series    INTEGER NOT NULL,      -- 0 film or TV film, 1 series or mini-series
        title     TEXT    NOT NULL,
        original  TEXT,                  -- only when not the same as title
        year      INTEGER,
        end_year  INTEGER,
        runtime   INTEGER,               -- minutes
        genres    TEXT,                  -- IMDb's, comma-separated
        votes     INTEGER NOT NULL,
        rating    REAL    NOT NULL,
        norm      TEXT    NOT NULL,
        norm_original TEXT
    );
    CREATE VIRTUAL TABLE names USING fts5(name, content='', detail=none,
                                          tokenize='unicode61 remove_diacritics 2');
";

const INDEXES: &str = "
    CREATE INDEX titles_norm ON titles (norm);
    CREATE INDEX titles_norm_original ON titles (norm_original) WHERE norm_original IS NOT NULL;
";

/// Reads `title.basics` and keeps the rows worth matching against: films and
/// series, not adult, with `MIN_VOTES` or more. Returns how many were kept.
fn read_titles<R: Read>(gzipped: R, votes: &Votes, conn: &mut Connection) -> Result<usize, String> {
    let reader = BufReader::with_capacity(1 << 16, flate2::read::MultiGzDecoder::new(gzipped));
    let tx = conn.transaction().map_err(to_string_err)?;
    let mut kept = 0usize;
    {
        let mut insert = tx
            .prepare(
                "INSERT INTO titles (id, series, title, original, year, end_year, runtime, genres,
                                     votes, rating, norm, norm_original)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            )
            .map_err(to_string_err)?;
        let mut name = tx
            .prepare("INSERT INTO names (rowid, name) VALUES (?1, ?2)")
            .map_err(to_string_err)?;
        for line in reader.lines() {
            let line = line.map_err(|e| format!("the list could not be read: {e}"))?;
            let f: Vec<&str> = line.split('\t').collect();
            // tconst, titleType, primaryTitle, originalTitle, isAdult,
            // startYear, endYear, runtimeMinutes, genres
            if f.len() < 9 || f[4] != "0" {
                continue;
            }
            let series = match f[1] {
                "movie" | "tvMovie" => false,
                "tvSeries" | "tvMiniSeries" => true,
                _ => continue,
            };
            let Some(id) = id_number(f[0]) else { continue };
            let Ok(at) = votes.binary_search_by_key(&id, |v| v.0) else { continue };
            let (_, rating, count) = votes[at];
            let title = f[2];
            let original = unknown(f[3]).filter(|o| *o != title);
            let norm = normalise(title);
            let norm_original = original.map(normalise).filter(|n| *n != norm);
            insert
                .execute(params![
                    id,
                    series,
                    title,
                    original,
                    unknown(f[5]).and_then(|y| y.parse::<i64>().ok()),
                    unknown(f[6]).and_then(|y| y.parse::<i64>().ok()),
                    unknown(f[7]).and_then(|m| m.parse::<i64>().ok()),
                    unknown(f[8]),
                    count,
                    f64::from(rating),
                    norm,
                    norm_original,
                ])
                .map_err(to_string_err)?;
            let words = match &norm_original {
                Some(other) => format!("{norm} {other}"),
                None => norm,
            };
            name.execute(params![id, words]).map_err(to_string_err)?;
            kept += 1;
        }
    }
    tx.commit().map_err(to_string_err)?;
    Ok(kept)
}

#[cfg(test)]
/// Builds the list at `path` from the two files and swaps it in; see
/// `build_and_swap_with_votes`. `min_rows` is what a believable list has.
fn build_and_swap<R1: Read, R2: Read>(
    path: &Path,
    ratings: R1,
    basics: R2,
    now: i64,
    min_rows: usize,
) -> Result<usize, String> {
    let votes = read_votes(ratings).map_err(|e| format!("the ratings could not be read: {e}"))?;
    build_and_swap_with_votes(path, votes, basics, now, min_rows)
}

// ---------------------------------------------------------------------------
// Downloading, as it arrives.
// ---------------------------------------------------------------------------

/// Chunks of a download, read on the building thread as an ordinary `Read`.
/// The channel is short, so the download waits while the building catches up
/// and never more than a few chunks are held.
struct Arriving {
    chunks: tokio::sync::mpsc::Receiver<Result<bytes::Bytes, String>>,
    current: bytes::Bytes,
}

impl Read for Arriving {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        while self.current.is_empty() {
            match self.chunks.blocking_recv() {
                Some(Ok(chunk)) => self.current = chunk,
                Some(Err(e)) => return Err(std::io::Error::other(e)),
                None => return Ok(0),
            }
        }
        let n = buf.len().min(self.current.len());
        buf[..n].copy_from_slice(&self.current[..n]);
        self.current = self.current.slice(n..);
        Ok(n)
    }
}

/// Where a build is: which file, how many bytes of it, out of how many.
static BUILDING: AtomicBool = AtomicBool::new(false);
static PHASE: AtomicU8 = AtomicU8::new(0);
static DONE: AtomicU64 = AtomicU64::new(0);
static TOTAL: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// "ratings" or "titles".
    pub phase: &'static str,
    pub done: u64,
    /// The file's size, when the server said it.
    pub total: Option<u64>,
}

fn progress() -> Option<Progress> {
    BUILDING.load(Ordering::SeqCst).then(|| Progress {
        phase: if PHASE.load(Ordering::SeqCst) == 0 { "ratings" } else { "titles" },
        done: DONE.load(Ordering::SeqCst),
        total: Some(TOTAL.load(Ordering::SeqCst)).filter(|t| *t > 0),
    })
}

/// Starts `url` and hands back its chunks as they come. A body shorter than
/// the size the server gave is an error, not the end of the file.
async fn stream(
    app: tauri::AppHandle,
    url: &'static str,
    phase: u8,
) -> Result<Arriving, String> {
    use tauri::Emitter;
    let client = crate::net::client(crate::net::Service::ImdbTitles)?
        .timeout(TIMEOUT)
        .user_agent(concat!("Skrin/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(to_string_err)?;
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("IMDb's list: the download did not start: {e}"))?;
    let total = response.content_length();
    PHASE.store(phase, Ordering::SeqCst);
    DONE.store(0, Ordering::SeqCst);
    TOTAL.store(total.unwrap_or(0), Ordering::SeqCst);
    let (send, chunks) = tokio::sync::mpsc::channel(4);
    tauri::async_runtime::spawn(async move {
        let (mut done, mut said) = (0u64, 0u64);
        loop {
            let next = match response.chunk().await {
                Ok(Some(chunk)) => {
                    done += chunk.len() as u64;
                    DONE.store(done, Ordering::SeqCst);
                    if done - said >= total.unwrap_or(4_000_000) / 100 {
                        said = done;
                        let _ = app.emit("imdb-titles-progress", progress());
                    }
                    Ok(chunk)
                }
                Ok(None) => match total {
                    Some(total) if done < total => {
                        Err(format!("the download stopped at {done} of {total} bytes"))
                    }
                    _ => break,
                },
                Err(e) => Err(format!("the download stopped: {e}")),
            };
            let failed = next.is_err();
            if send.send(next).await.is_err() || failed {
                break;
            }
        }
    });
    Ok(Arriving { chunks, current: bytes::Bytes::new() })
}

pub fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::data_dir(app)?.join(FILE_NAME))
}

fn allowed(app: &tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    let db = app.state::<crate::library::Db>();
    let conn = db.0.lock().map_err(to_string_err)?;
    Ok(crate::settings::setting(&conn, ALLOWED_KEY).as_deref() == Some("1"))
}

/// When the list at `path` was built, or None when there is none.
fn built_at(path: &Path) -> Option<(i64, i64)> {
    let conn = open(path).ok()?;
    let get = |key: &str| -> Option<i64> {
        conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get::<_, String>(0))
            .ok()?
            .parse()
            .ok()
    };
    Some((get("built_at")?, get("rows")?))
}

fn due(built: Option<(i64, i64)>, now: i64) -> bool {
    built.is_none_or(|(at, _)| now - at >= MAX_AGE)
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueStatus {
    /// The setting allowing the download is on.
    pub allowed: bool,
    /// A list is there to match against.
    pub present: bool,
    pub rows: i64,
    /// When it was built, seconds since the epoch.
    pub built_at: Option<i64>,
    /// Its size on disk, in bytes.
    pub bytes: u64,
    /// A download under way.
    pub progress: Option<Progress>,
}

#[tauri::command]
pub fn imdb_titles_status(app: tauri::AppHandle) -> Result<CatalogueStatus, String> {
    let path = path(&app)?;
    let built = built_at(&path);
    Ok(CatalogueStatus {
        allowed: allowed(&app)?,
        present: built.is_some(),
        rows: built.map_or(0, |b| b.1),
        built_at: built.map(|b| b.0),
        bytes: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        progress: progress(),
    })
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RefreshReport {
    /// The list was downloaded and built on this call.
    pub built: bool,
    pub rows: usize,
    /// Why nothing was done: "not allowed", "not due", "already running".
    pub skipped: Option<&'static str>,
}

/// The list deleted from this computer: its switch went off, or the mode
/// did. Bytes freed; 0 when there was none, or a download is under way (it
/// finds the switch off at its next start and builds nothing).
#[tauri::command]
pub fn imdb_titles_remove(app: tauri::AppHandle) -> Result<u64, String> {
    if BUILDING.load(Ordering::SeqCst) {
        return Ok(0);
    }
    let path = path(&app)?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if bytes > 0 {
        std::fs::remove_file(&path).map_err(to_string_err)?;
        crate::log!("imdb titles: list removed ({bytes} bytes)");
    }
    Ok(bytes)
}

/// Download and build the list, if allowed and over a month old (or never
/// built). `force` skips the month only — never the setting.
#[tauri::command]
pub async fn refresh_imdb_titles(app: tauri::AppHandle, force: Option<bool>) -> Result<RefreshReport, String> {
    if !allowed(&app)? {
        return Ok(RefreshReport { skipped: Some("not allowed"), ..Default::default() });
    }
    let path = path(&app)?;
    let now = crate::util::now_secs();
    if !force.unwrap_or(false) && !due(built_at(&path), now) {
        return Ok(RefreshReport { skipped: Some("not due"), ..Default::default() });
    }
    if BUILDING.swap(true, Ordering::SeqCst) {
        return Ok(RefreshReport { skipped: Some("already running"), ..Default::default() });
    }
    let result = refresh(app.clone(), path, now).await;
    BUILDING.store(false, Ordering::SeqCst);
    {
        use tauri::Emitter;
        let _ = app.emit("imdb-titles-progress", None::<Progress>);
    }
    result
}

async fn refresh(app: tauri::AppHandle, path: PathBuf, now: i64) -> Result<RefreshReport, String> {
    crate::jobs::wait_for_turn_async().await;
    let started = std::time::Instant::now();
    // One file after the other: the ratings decide which titles are kept.
    let ratings = stream(app.clone(), crate::imdb::RATINGS_URL, 0).await?;
    let votes = crate::jobs::off_main_background(move || {
        read_votes(ratings).map_err(|e| format!("IMDb's ratings could not be read: {e}"))
    })
    .await?;
    let basics = stream(app.clone(), BASICS_URL, 1).await?;
    let kept = crate::jobs::off_main_background(move || {
        build_and_swap_with_votes(&path, votes, basics, now, MIN_ROWS_REAL)
    })
    .await
    .map_err(|e| format!("IMDb's list: {e}"))?;
    crate::log!(
        "imdb titles: {kept} kept, built in {:.0}s",
        started.elapsed().as_secs_f64()
    );
    Ok(RefreshReport { built: true, rows: kept, skipped: None })
}

/// Builds the list into a `.part` file beside `path` and, when it is whole and
/// believable, swaps it in. Any failure removes the part-built file and leaves
/// the old list as it was.
fn build_and_swap_with_votes<R: Read>(
    path: &Path,
    votes: Votes,
    basics: R,
    now: i64,
    min_rows: usize,
) -> Result<usize, String> {
    let part = path.with_extension("db.part");
    let built = (|| {
        let _ = std::fs::remove_file(&part);
        let mut conn = Connection::open(&part).map_err(to_string_err)?;
        conn.execute_batch("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;")
            .map_err(to_string_err)?;
        conn.execute_batch(SCHEMA).map_err(to_string_err)?;
        let kept = read_titles(basics, &votes, &mut conn)?;
        finish(conn, kept, now, min_rows)?;
        std::fs::rename(&part, path).map_err(to_string_err)?;
        Ok(kept)
    })();
    if built.is_err() {
        let _ = std::fs::remove_file(&part);
    }
    built
}

fn finish(conn: Connection, kept: usize, now: i64, min_rows: usize) -> Result<(), String> {
    if kept < min_rows {
        return Err(format!(
            "IMDb's list had only {kept} titles worth keeping; the one before is kept"
        ));
    }
    conn.execute_batch(INDEXES).map_err(to_string_err)?;
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('built_at', ?1), ('rows', ?2)",
        params![now.to_string(), kept.to_string()],
    )
    .map_err(to_string_err)?;
    conn.execute_batch("INSERT INTO names (names) VALUES ('optimize');")
        .map_err(to_string_err)?;
    conn.close().map_err(|(_, e)| e.to_string())
}

// ---------------------------------------------------------------------------
// Looking names up.
// ---------------------------------------------------------------------------

fn open(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
}

/// One title of the list, as the matcher scores it.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImdbTitle {
    /// `tt0133093`.
    pub imdb_id: String,
    pub series: bool,
    pub title: String,
    pub original_title: Option<String>,
    pub year: Option<i64>,
    pub end_year: Option<i64>,
    pub runtime_mins: Option<i64>,
    pub genres: Vec<String>,
    pub votes: i64,
    pub rating: f64,
}

const COLUMNS: &str = "id, series, title, original, year, end_year, runtime, genres, votes, rating";

fn row(r: &rusqlite::Row) -> rusqlite::Result<ImdbTitle> {
    let genres: Option<String> = r.get(7)?;
    Ok(ImdbTitle {
        imdb_id: format!("tt{:07}", r.get::<_, i64>(0)?),
        series: r.get(1)?,
        title: r.get(2)?,
        original_title: r.get(3)?,
        year: r.get(4)?,
        end_year: r.get(5)?,
        runtime_mins: r.get(6)?,
        genres: genres
            .map(|g| g.split(',').map(str::to_string).collect())
            .unwrap_or_default(),
        votes: r.get(8)?,
        rating: r.get(9)?,
    })
}

/// How many of each way of finding a name are kept, most voted first.
const EXACT_LIMIT: i64 = 200;
const PREFIX_LIMIT: i64 = 30;
const WORDS_LIMIT: i64 = 30;
/// Rows read to find names whose every word is in the file's name.
const WORD_SCAN: i64 = 20_000;

/// Words that find everything and so say nothing.
fn telling(word: &str) -> bool {
    !matches!(word, "the" | "a" | "an" | "and" | "of" | "in" | "on" | "to" | "de" | "la" | "le")
}

/// The list's titles a file's name may be, for the scorer to decide among:
/// the same name or original name; names that begin with it ("Alien" →
/// "Alien 3"); names it begins with ("Glass Onion A Knives Out Mystery" →
/// "Glass Onion"); names with every one of its words; and names whose every
/// word is in it ("Jurassic World 3 Dominion" → "Jurassic World Dominion").
fn candidates(conn: &Connection, names: &[String], series: bool) -> rusqlite::Result<Vec<ImdbTitle>> {
    let mut found: Vec<ImdbTitle> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut keep = |rows: Vec<ImdbTitle>| {
        for t in rows {
            if seen.insert(t.imdb_id.clone()) {
                found.push(t);
            }
        }
    };
    let query = |sql: &str, p: &[&dyn rusqlite::ToSql]| -> rusqlite::Result<Vec<ImdbTitle>> {
        let mut stmt = conn.prepare_cached(sql)?;
        let rows = stmt.query_map(p, row)?;
        rows.collect()
    };
    let exact = format!(
        "SELECT {COLUMNS} FROM titles WHERE series = ?1 AND (norm = ?2 OR norm_original = ?2)
          ORDER BY votes DESC LIMIT {EXACT_LIMIT}"
    );
    let prefix = format!(
        "SELECT {COLUMNS} FROM titles WHERE series = ?1 AND norm >= ?2 AND norm < ?3
          ORDER BY votes DESC LIMIT {PREFIX_LIMIT}"
    );
    for raw in names {
        let norm = normalise(raw);
        if norm.is_empty() {
            continue;
        }
        keep(query(&exact, &[&series, &norm])?);
        // "alien " up to "alien!" — every name that goes on after a space.
        keep(query(&prefix, &[&series, &format!("{norm} "), &format!("{norm}!")])?);
        let words: Vec<&str> = norm.split(' ').collect();
        for k in 1..words.len() {
            let start = words[..k].join(" ");
            if start.len() >= 3 {
                let mut some = query(&exact, &[&series, &start])?;
                some.truncate(10);
                keep(some);
            }
        }
        let wanted: Vec<&str> = words.iter().copied().filter(|w| telling(w)).collect();
        if wanted.is_empty() {
            continue;
        }
        let quoted: Vec<String> = wanted.iter().map(|w| format!("\"{w}\"")).collect();
        let every = format!(
            "SELECT {COLUMNS} FROM titles WHERE series = ?1 AND id IN
                 (SELECT rowid FROM names WHERE names MATCH ?2)
              ORDER BY votes DESC LIMIT {WORDS_LIMIT}"
        );
        keep(query(&every, &[&series, &quoted.join(" AND ")])?);
        if wanted.len() >= 2 {
            let mut stmt = conn.prepare_cached(&format!(
                "SELECT {COLUMNS}, norm, norm_original FROM titles WHERE series = ?1 AND id IN
                     (SELECT rowid FROM names WHERE names MATCH ?2 LIMIT {WORD_SCAN})"
            ))?;
            let all: HashSet<&str> = words.iter().copied().collect();
            let inside = |n: &str| n.split(' ').all(|w| all.contains(w));
            let mut within: Vec<ImdbTitle> = stmt
                .query_map(params![series, quoted.join(" OR ")], |r| {
                    let n: String = r.get(10)?;
                    let o: Option<String> = r.get(11)?;
                    Ok((row(r)?, n, o))
                })?
                .filter_map(Result::ok)
                .filter(|(_, n, o)| {
                    (n.contains(' ') && inside(n)) || o.as_deref().is_some_and(|o| o.contains(' ') && inside(o))
                })
                .map(|(t, _, _)| t)
                .collect();
            within.sort_by_key(|t| std::cmp::Reverse(t.votes));
            within.truncate(WORDS_LIMIT as usize);
            keep(within);
        }
    }
    Ok(found)
}

fn by_id(conn: &Connection, imdb_id: &str) -> rusqlite::Result<Option<ImdbTitle>> {
    let Some(id) = id_number(imdb_id) else { return Ok(None) };
    conn.query_row(&format!("SELECT {COLUMNS} FROM titles WHERE id = ?1"), [id], row)
        .optional()
}

fn opened(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = path(app)?;
    if !path.exists() {
        return Err("IMDb's list of titles is not downloaded yet".into());
    }
    open(&path).map_err(to_string_err)
}

/// The titles a name may be, for the matcher (match.ts, provider `imdb`).
#[tauri::command]
pub async fn imdb_titles_search(
    app: tauri::AppHandle,
    names: Vec<String>,
    series: bool,
) -> Result<Vec<ImdbTitle>, String> {
    crate::jobs::off_main_background(move || {
        let conn = opened(&app)?;
        candidates(&conn, &names, series).map_err(to_string_err)
    })
    .await
}

/// One title by its IMDb id, or null when the list does not have it.
#[tauri::command]
pub fn imdb_titles_get(app: tauri::AppHandle, imdb_id: String) -> Result<Option<ImdbTitle>, String> {
    let conn = opened(&app)?;
    by_id(&conn, &imdb_id).map_err(to_string_err)
}

/// The running time of the first of these files that has been read, in
/// minutes: what the matcher's tie-break compares with IMDb's runtime.
#[tauri::command]
pub fn imdb_file_minutes(
    db: tauri::State<crate::library::Db>,
    file_ids: Vec<i64>,
) -> Result<Option<f64>, String> {
    let conn = db.0.lock().map_err(to_string_err)?;
    Ok(file_ids
        .iter()
        .filter_map(|id| crate::probe::details_for_file(&conn, *id)?.duration_secs)
        .find(|secs| *secs > 0.0)
        .map(|secs| secs / 60.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn gzip(text: &str) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(text.as_bytes()).unwrap();
        encoder.finish().unwrap()
    }

    const RATINGS: &str = "tconst\taverageRating\tnumVotes\n\
        tt0000001\t5.0\t9\n\
        tt0133093\t8.7\t2213456\n\
        tt0944947\t9.2\t2400000\n\
        tt0103064\t8.6\t1200000\n\
        tt0078748\t8.5\t950000\n\
        tt0103644\t6.4\t320000\n\
        tt0090605\t8.4\t780000\n\
        tt8760708\t7.1\t200\n\
        tt0000002\t7.0\t50\n\
        tt0000003\t7.0\t50\n\
        tt0000004\t7.0\t50\n";

    const BASICS: &str = "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres\n\
        tt0000001\tmovie\tStub\tStub\t0\t\\N\t\\N\t\\N\t\\N\n\
        tt0133093\tmovie\tThe Matrix\tThe Matrix\t0\t1999\t\\N\t136\tAction,Sci-Fi\n\
        tt0944947\ttvSeries\tGame of Thrones\tGame of Thrones\t0\t2011\t2019\t57\tDrama\n\
        tt0103064\tmovie\tTerminator 2: Judgment Day\tTerminator 2: Judgment Day\t0\t1991\t\\N\t137\tAction\n\
        tt0078748\tmovie\tAlien\tAlien\t0\t1979\t\\N\t117\tHorror\n\
        tt0103644\tmovie\tAlien³\tAlien³\t0\t1992\t\\N\t114\tHorror\n\
        tt0090605\tmovie\tAliens\tAliens\t0\t1986\t\\N\t137\tAction\n\
        tt8760708\tmovie\tAmélie's Café\tLe café d'Amélie\t0\t2001\t\\N\t122\tComedy\n\
        tt0000002\ttvEpisode\tAn episode\tAn episode\t0\t2001\t\\N\t40\tDrama\n\
        tt0000003\tmovie\tAdult\tAdult\t1\t2001\t\\N\t80\tAdult\n\
        tt0000004\tvideoGame\tA game\tA game\t0\t2001\t\\N\t\\N\tAction\n";

    fn built(dir: &Path) -> PathBuf {
        let path = dir.join(FILE_NAME);
        let kept = build_and_swap(&path, gzip(RATINGS).as_slice(), gzip(BASICS).as_slice(), 1000, 1)
            .unwrap();
        assert_eq!(kept, 7, "films and series with 10+ votes, no episodes, adult or games");
        path
    }

    struct Temp(PathBuf);
    impl Temp {
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn temp() -> Temp {
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "skrin-imdb-titles-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Temp(dir)
    }

    fn ids(found: &[ImdbTitle]) -> Vec<&str> {
        found.iter().map(|t| t.imdb_id.as_str()).collect()
    }

    #[test]
    fn names_are_normalised_the_way_the_scorer_does() {
        assert_eq!(normalise("The Matrix"), "matrix");
        assert_eq!(normalise("Ocean's Eleven"), "oceans eleven");
        assert_eq!(normalise("Fast & Furious"), "fast and furious");
        assert_eq!(normalise("Amélie"), "amelie");
        assert_eq!(normalise("Spider-Man: No Way Home"), "spider man no way home");
        assert_eq!(normalise("The"), "the", "a name that is only an article keeps it");
    }

    #[test]
    fn only_films_and_series_with_ten_votes_are_kept() {
        let dir = temp();
        let path = built(dir.path());
        let conn = open(&path).unwrap();
        assert_eq!(by_id(&conn, "tt0000001").unwrap(), None, "9 votes");
        assert_eq!(by_id(&conn, "tt0000002").unwrap(), None, "an episode");
        assert_eq!(by_id(&conn, "tt0000003").unwrap(), None, "adult");
        let matrix = by_id(&conn, "tt0133093").unwrap().unwrap();
        assert_eq!(matrix.title, "The Matrix");
        assert_eq!(matrix.original_title, None, "the same name is not kept twice");
        assert_eq!(matrix.year, Some(1999));
        assert_eq!(matrix.runtime_mins, Some(136));
        assert_eq!(matrix.genres, vec!["Action", "Sci-Fi"]);
        assert_eq!(matrix.votes, 2_213_456);
        assert!(!matrix.series);
        let got = by_id(&conn, "tt0944947").unwrap().unwrap();
        assert!(got.series);
        assert_eq!(got.end_year, Some(2019));
        assert_eq!(built_at(&path), Some((1000, 7)));
    }

    #[test]
    fn a_name_finds_itself_its_longer_names_and_its_words() {
        let dir = temp();
        let conn = open(&built(dir.path())).unwrap();
        let find = |name: &str| candidates(&conn, &[name.to_string()], false).unwrap();
        assert_eq!(ids(&find("The Matrix"))[0], "tt0133093");
        assert_eq!(ids(&find("matrix")), vec!["tt0133093"]);
        // Starts with it.
        assert!(ids(&find("Terminator")).contains(&"tt0103064"));
        // It starts with the name: extra words in the file's name.
        assert!(ids(&find("Alien Directors Cut")).contains(&"tt0078748"));
        // Every word of the list's name is in the file's name.
        assert!(ids(&find("Terminator 2 Judgment Day Extended")).contains(&"tt0103064"));
        // The original name, accents and apostrophes.
        assert!(ids(&find("Le Cafe dAmelie")).contains(&"tt8760708"));
        assert!(ids(&find("Amelies Cafe")).contains(&"tt8760708"));
        // Films are not series.
        assert!(find("Game of Thrones").is_empty());
        let shows = candidates(&conn, &["Game of Thrones".into()], true).unwrap();
        assert_eq!(ids(&shows), vec!["tt0944947"]);
        assert!(find("Nothing like it").is_empty());
    }

    #[test]
    fn a_broken_download_keeps_the_list_there_was() {
        let dir = temp();
        let path = built(dir.path());
        let before = std::fs::read(&path).unwrap();
        // Cut off half way: gunzip says so, nothing is swapped in.
        let whole = gzip(BASICS);
        let cut = &whole[..whole.len() / 2];
        let failed = build_and_swap(&path, gzip(RATINGS).as_slice(), cut, 2000, 1);
        assert!(failed.is_err(), "{failed:?}");
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(!path.with_extension("db.part").exists());
        // Not gzip at all.
        assert!(build_and_swap(&path, gzip(RATINGS).as_slice(), BASICS.as_bytes(), 2000, 1).is_err());
        // Too few titles to be IMDb's real list.
        assert!(build_and_swap(&path, gzip(RATINGS).as_slice(), gzip(BASICS).as_slice(), 2000, 100).is_err());
        assert_eq!(built_at(&path), Some((1000, 7)));
    }

    #[test]
    fn a_download_cut_short_is_an_error_not_an_end() {
        let (send, chunks) = tokio::sync::mpsc::channel(4);
        let mut arriving = Arriving { chunks, current: bytes::Bytes::new() };
        std::thread::spawn(move || {
            send.blocking_send(Ok(bytes::Bytes::from_static(b"abc"))).unwrap();
            send.blocking_send(Err("the download stopped at 3 of 9 bytes".into())).unwrap();
        });
        let mut got = Vec::new();
        let err = arriving.read_to_end(&mut got).unwrap_err();
        assert_eq!(got, b"abc");
        assert!(err.to_string().contains("stopped"), "{err}");
    }

    #[test]
    fn it_is_due_with_none_and_after_a_month() {
        assert!(due(None, 0));
        assert!(!due(Some((1000, 5)), 1000 + 29 * DAY));
        assert!(due(Some((1000, 5)), 1000 + 30 * DAY));
    }

    /// The dry run, first half: every title of a library matched online that
    /// has an IMDb id, with the names its files were parsed to and the list's
    /// candidates for them, exactly as the app looks them up. Written as JSON
    /// for `imdbDryRun.test.ts`, which decides with the app's own rules.
    /// `DRYRUN_LIBRARY` (a copy of library.db, opened read-only),
    /// `IMDB_TITLES_DB`, `DRYRUN_OUT`.
    #[test]
    #[ignore = "needs a library copy and the real list"]
    fn dry_run_candidates() {
        let env = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("{k} not set"));
        let library = open(Path::new(&env("DRYRUN_LIBRARY"))).unwrap();
        let list = open(Path::new(&env("IMDB_TITLES_DB"))).unwrap();
        let mut stmt = library
            .prepare(
                "SELECT t.id, t.kind = 'series', t.imdb_id, m.parsed_title, m.parsed_year,
                        (SELECT p.details FROM media_probe p WHERE p.file_id = m.id)
                   FROM titles t JOIN media_files m ON m.title_id = t.id
                  WHERE t.provider = 'tmdb' AND t.imdb_id LIKE 'tt%'
                    AND m.parsed_title IS NOT NULL AND m.parsed_title <> ''
                  ORDER BY t.id, m.id",
            )
            .unwrap();
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, bool>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            })
            .unwrap();
        let started = std::time::Instant::now();
        for row in rows {
            let (id, series, expected, name, year, details) = row.unwrap();
            // One group per title, as the matcher groups a title's files.
            if !seen.insert(id) {
                continue;
            }
            let mut names = vec![name.clone()];
            if let Some(cut) = name.find(" - ").filter(|c| *c > 0) {
                names.push(name[..cut].trim().to_string());
            }
            let found = candidates(&list, &names, series).unwrap();
            let minutes = details
                .and_then(|d| serde_json::from_str::<serde_json::Value>(&d).ok())
                .and_then(|d| d.get("duration_secs")?.as_f64())
                .map(|s| s / 60.0);
            out.push(serde_json::json!({
                "series": series, "expected": expected, "name": name, "year": year,
                "names": names, "minutes": if series { None } else { minutes },
                "candidates": found,
            }));
        }
        println!("{} groups looked up in {:.2}s", out.len(), started.elapsed().as_secs_f64());
        std::fs::write(env("DRYRUN_OUT"), serde_json::to_string(&out).unwrap()).unwrap();
    }

    /// The real files: time, size and peak memory of a build. Prints them.
    /// `IMDB_TITLES_OUT` keeps the list for the dry run.
    #[test]
    #[ignore = "downloads IMDb's two files (240 MB)"]
    fn builds_from_the_real_files() {
        let out = std::env::var("IMDB_TITLES_OUT").map(PathBuf::from).unwrap_or_else(|_| {
            std::env::temp_dir().join(FILE_NAME)
        });
        let curl = |url: &str| {
            std::process::Command::new("curl")
                .args(["-sL", url])
                .stdout(std::process::Stdio::piped())
                .spawn()
                .expect("curl")
                .stdout
                .unwrap()
        };
        let started = std::time::Instant::now();
        let kept = build_and_swap(&out, curl(crate::imdb::RATINGS_URL), curl(BASICS_URL), 1, MIN_ROWS_REAL)
            .unwrap();
        let size = std::fs::metadata(&out).unwrap().len();
        println!(
            "kept {kept} titles, {:.1} MB, in {:.0}s",
            size as f64 / 1e6,
            started.elapsed().as_secs_f64()
        );
        let conn = open(&out).unwrap();
        assert!(ids(&candidates(&conn, &["The Matrix".into()], false).unwrap()).contains(&"tt0133093"));
    }
}
