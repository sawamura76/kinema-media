//! MusicBrainz album matching. The returned patch is a draft until Save.
use crate::{
    album_art,
    music::MusicTrack,
    music_art::bytes,
    music_tags::{self, TagPatch},
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tauri_plugin_http::reqwest;

#[derive(Deserialize)]
struct Credit {
    name: String,
    #[serde(default)]
    joinphrase: String,
    artist: Option<ArtistIdentity>,
}
#[derive(Deserialize)]
struct ArtistIdentity {
    name: String,
    #[serde(default, rename = "sort-name")]
    sort_name: String,
    #[serde(default)]
    genres: Vec<Genre>,
}
fn credit(credits: &[Credit]) -> String {
    credits
        .iter()
        .map(|entry| format!("{}{}", entry.name, entry.joinphrase))
        .collect()
}

fn library_credit(credits: &[Credit], names: &[String]) -> String {
    let display = credit(credits);
    let exact = normalized(&display);
    if let Some(name) = names.iter().find(|name| normalized(name) == exact) {
        return name.clone();
    }
    if let [entry] = credits {
        if let Some(identity) = &entry.artist {
            let canonical = normalized(&identity.name);
            let sort = normalized(&identity.sort_name);
            if let Some(name) = names.iter().find(|name| {
                let key = normalized(name);
                !key.is_empty() && (key == canonical || key == sort)
            }) {
                return name.clone();
            }
        }
    }
    display
}

fn known_artists(conn: &rusqlite::Connection) -> Result<Vec<String>, String> {
    let mut statement = conn.prepare("SELECT album_artist FROM music_tracks WHERE missing=0 AND album_artist!='Unknown artist' GROUP BY album_artist ORDER BY COUNT(*) DESC, album_artist")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn nullable_text<'de, D: serde::Deserializer<'de>>(decoder: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(decoder)?.unwrap_or_default())
}

#[derive(Deserialize)]
struct SearchResult {
    releases: Vec<ReleaseSummary>,
}
#[derive(Deserialize)]
struct ReleaseSummary {
    id: String,
    title: String,
    #[serde(default, deserialize_with = "nullable_text")]
    date: String,
    #[serde(default, deserialize_with = "nullable_text")]
    country: String,
    #[serde(default, deserialize_with = "nullable_text")]
    disambiguation: String,
    #[serde(default, rename = "artist-credit")]
    artist: Vec<Credit>,
    #[serde(default, rename = "release-group")]
    group: Option<ReleaseGroup>,
    #[serde(default, rename = "track-count")]
    track_count: usize,
}

#[derive(Deserialize)]
struct Release {
    id: String,
    title: String,
    #[serde(default, deserialize_with = "nullable_text")]
    date: String,
    #[serde(default, rename = "artist-credit")]
    artist: Vec<Credit>,
    #[serde(default, rename = "release-group")]
    group: Option<ReleaseGroup>,
    #[serde(default)]
    media: Vec<Medium>,
    #[serde(default)]
    genres: Vec<Genre>,
}
#[derive(Deserialize)]
struct ReleaseGroup {
    id: String,
    #[serde(
        default,
        rename = "first-release-date",
        deserialize_with = "nullable_text"
    )]
    date: String,
}
#[derive(Deserialize)]
struct Genre {
    name: String,
    count: u64,
}
#[derive(Deserialize)]
struct Medium {
    position: u32,
    #[serde(default)]
    tracks: Vec<RecordingTrack>,
}
#[derive(Deserialize)]
struct RecordingTrack {
    position: u32,
    title: String,
    length: Option<u64>,
    #[serde(default, rename = "artist-credit")]
    artist: Vec<Credit>,
    recording: Option<Recording>,
}
#[derive(Deserialize)]
struct Recording {
    title: String,
    length: Option<u64>,
    #[serde(default, rename = "artist-credit")]
    artist: Vec<Credit>,
}
#[derive(Serialize)]
pub struct MatchDraft {
    album: String,
    artist: String,
    release_id: String,
    tracks: Vec<TagPatch>,
    cover: Option<String>,
}

fn normalized(value: &str) -> String {
    crate::music_art::normalized(value)
}

fn filename(track: &MusicTrack) -> &str {
    Path::new(&track.path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("")
}

fn filename_parts(name: &str) -> (Option<u32>, &str) {
    let digits = name.bytes().take_while(u8::is_ascii_digit).count();
    let (number, rest) = name.split_at(digits);
    if rest.starts_with([' ', '.', '_', '-']) {
        return (
            number.parse().ok(),
            rest.trim_start_matches([' ', '.', '_', '-']),
        );
    }
    (None, name)
}

fn track_positions(release: &Release, tracks: &[MusicTrack]) -> Option<Vec<(u32, usize)>> {
    let all: Vec<_> = release
        .media
        .iter()
        .flat_map(|medium| {
            medium
                .tracks
                .iter()
                .map(move |track| (medium.position, track))
        })
        .collect();
    if all.len() != tracks.len() {
        return None;
    }
    let mut matched = HashSet::new();
    let mut positions = Vec::with_capacity(tracks.len());
    let mut title_matches = 0;
    for local in tracks {
        let (file_number, file_title) = filename_parts(filename(local));
        let titles = [normalized(&local.title), normalized(file_title)];
        let number = file_number.or((local.track != 0).then_some(local.track));
        let mut choices = Vec::new();
        for (index, (disc, remote)) in all.iter().enumerate() {
            let length = remote.length.or_else(|| {
                remote
                    .recording
                    .as_ref()
                    .and_then(|recording| recording.length)
            });
            let delta = length
                .filter(|ms| *ms > 0 && local.duration > 0.0)
                .map(|ms| (ms as f64 / 1000.0 - local.duration).abs());
            if delta.is_some_and(|seconds| seconds > 8.0) {
                continue;
            }
            let remote_title = normalized(&remote.title);
            let recording_title = remote
                .recording
                .as_ref()
                .map(|recording| normalized(&recording.title));
            let same_title = titles.iter().any(|title| {
                !title.is_empty()
                    && (title == &remote_title || Some(title) == recording_title.as_ref())
            });
            let same_position = number == Some(remote.position) && local.disc == *disc;
            if same_title || (same_position && delta.is_some_and(|seconds| seconds <= 3.0)) {
                let score = u8::from(same_title) * 4
                    + u8::from(same_position) * 2
                    + u8::from(delta.is_some_and(|seconds| seconds <= 3.0));
                choices.push((score, index, same_title));
            }
        }
        choices.sort_unstable_by_key(|choice| std::cmp::Reverse(choice.0));
        let &(score, index, same_title) = choices.first()?;
        if choices.get(1).is_some_and(|choice| choice.0 == score) || !matched.insert(index) {
            return None;
        }
        title_matches += usize::from(same_title);
        positions.push((all[index].0, index));
    }
    // Position and duration can repair individual bad titles. The album itself
    // still needs independent evidence from most of its titles.
    (title_matches > tracks.len() / 2).then_some(positions)
}

fn draft(
    release: &Release,
    locals: &[MusicTrack],
    manual: bool,
    names: &[String],
) -> Option<MatchDraft> {
    let artist = library_credit(&release.artist, names);
    if artist.trim().is_empty() || release.title.trim().is_empty() {
        return None;
    }
    let positions = track_positions(release, locals).or_else(|| {
        if !manual {
            return None;
        }
        let remote: Vec<_> = release
            .media
            .iter()
            .flat_map(|disc| {
                disc.tracks
                    .iter()
                    .map(move |track| (disc.position, track.position))
            })
            .collect();
        if remote.len() != locals.len() {
            return None;
        }
        let mut used = HashSet::new();
        locals
            .iter()
            .map(|track| {
                let (filename_number, _) = filename_parts(filename(track));
                let position = (track.disc, filename_number.unwrap_or(track.track));
                let index = remote.iter().position(|value| *value == position)?;
                used.insert(index).then_some((position.0, index))
            })
            .collect()
    })?;
    let tracks: Vec<_> = release
        .media
        .iter()
        .flat_map(|medium| &medium.tracks)
        .collect();
    let genre = release
        .genres
        .iter()
        .chain(
            release
                .artist
                .iter()
                .flat_map(|credit| credit.artist.iter().flat_map(|artist| &artist.genres)),
        )
        .max_by_key(|genre| genre.count)
        .map(|genre| genre.name.clone());
    let date = release
        .group
        .as_ref()
        .map(|group| group.date.as_str())
        .filter(|date| !date.is_empty())
        .unwrap_or(&release.date);
    let year = date
        .split('-')
        .next()
        .filter(|year| year.len() == 4 && year.parse::<u16>().is_ok_and(|n| n > 0))
        .map(str::to_owned);
    let patches = locals
        .iter()
        .zip(positions)
        .map(|(local, (disc, index))| {
            let remote = tracks[index];
            let mut track_artist = library_credit(&remote.artist, names);
            if track_artist.is_empty() {
                track_artist = remote
                    .recording
                    .as_ref()
                    .map(|recording| library_credit(&recording.artist, names))
                    .unwrap_or_default();
            }
            if track_artist.is_empty() {
                track_artist = artist.clone();
            }
            TagPatch {
                id: local.id,
                embed_cover: false,
                title: Some(remote.title.clone()),
                artist: Some(track_artist),
                album_artist: Some(artist.clone()),
                album: Some(release.title.clone()),
                genre: genre.clone(),
                year: year.clone(),
                track: Some(remote.position.to_string()),
                disc: Some(disc.to_string()),
            }
        })
        .collect();
    Some(MatchDraft {
        album: release.title.clone(),
        artist,
        release_id: release.id.clone(),
        tracks: patches,
        cover: None,
    })
}

fn valid_id(id: &str) -> bool {
    id.len() == 36 && id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-')
}

async fn get<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    endpoint: &str,
    params: &[(&str, &str)],
) -> Result<T, String> {
    use reqwest::StatusCode;
    use std::time::Duration;

    let url = format!("https://musicbrainz.org/ws/2/{endpoint}");
    for retry_delay in [Some(2), Some(4), None] {
        album_art::pace_musicbrainz().await;
        let response = client
            .get(&url)
            .query(params)
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    "MusicBrainz took too long to respond. Try again in a moment."
                } else {
                    "Couldn't reach MusicBrainz. Check your connection and try again."
                }
            })?;
        let status = response.status();
        if matches!(
            status,
            StatusCode::TOO_MANY_REQUESTS
                | StatusCode::BAD_GATEWAY
                | StatusCode::SERVICE_UNAVAILABLE
                | StatusCode::GATEWAY_TIMEOUT
        ) {
            let Some(delay) = retry_delay else { break };
            let retry_after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok());
            if retry_after.is_some_and(|seconds| seconds > 15) {
                break;
            }
            tokio::time::sleep(Duration::from_secs(delay.max(retry_after.unwrap_or(0)))).await;
            continue;
        }
        if !status.is_success() {
            return Err(format!(
                "MusicBrainz couldn't complete the lookup (HTTP {status})."
            ));
        }
        return serde_json::from_slice(&bytes(response, 2 * 1024 * 1024).await?).map_err(|error| {
            crate::log!("MusicBrainz {endpoint} response could not be read: {error}");
            "MusicBrainz returned release data Kinema couldn't read. Try a different release."
                .into()
        });
    }
    Err("MusicBrainz is temporarily busy. Try again in a moment or use Edit Tags.".into())
}

fn query_text(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

fn album_hints(tracks: &[MusicTrack]) -> Vec<String> {
    let mut counts: HashMap<String, (usize, String)> = HashMap::new();
    for track in tracks {
        for hint in [
            Some(track.album.as_str()).filter(|name| *name != "Unknown album"),
            Path::new(&track.path)
                .parent()
                .and_then(Path::file_name)
                .and_then(|name| name.to_str()),
        ]
        .into_iter()
        .flatten()
        {
            let key = normalized(hint);
            if !key.is_empty() {
                counts.entry(key).or_insert_with(|| (0, hint.to_owned())).0 += 1;
            }
        }
    }
    let mut hints: Vec<_> = counts.into_values().collect();
    hints.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    hints.into_iter().take(3).map(|(_, hint)| hint).collect()
}

async fn search(
    dir: &Path,
    tracks: &[MusicTrack],
    names: &[String],
) -> Result<Option<MatchDraft>, String> {
    let client = client()?;
    let hints = album_hints(tracks);
    if hints.is_empty() {
        return Ok(None);
    }
    let release_terms: Vec<_> = hints
        .iter()
        .map(|name| format!("release:\"{}\"", query_text(name)))
        .collect();
    let release_query = format!(
        "({}) AND tracks:{}",
        release_terms.join(" OR "),
        tracks.len()
    );
    let expected: HashSet<_> = tracks
        .iter()
        .map(|track| normalized(&track.album_artist))
        .filter(|name| !name.is_empty() && name != "unknownartist")
        .collect();
    let mut queries = Vec::new();
    if let Some(artist) = expected.iter().next().filter(|_| expected.len() == 1) {
        let artist = tracks
            .iter()
            .find(|track| normalized(&track.album_artist) == *artist)
            .unwrap();
        queries.push(format!(
            "{release_query} AND artist:\"{}\"",
            query_text(&artist.album_artist)
        ));
    }
    queries.push(release_query);
    let mut checked = HashSet::new();
    let mut matches = Vec::new();
    for query in queries {
        let response: SearchResult = get(
            &client,
            "release/",
            &[("query", &query), ("fmt", "json"), ("limit", "20")],
        )
        .await?;
        let mut candidate_groups = HashMap::new();
        for release in response.releases {
            if !valid_id(&release.id)
                || release.track_count != tracks.len()
                || !hints
                    .iter()
                    .any(|hint| normalized(hint) == normalized(&release.title))
            {
                continue;
            }
            let group = release
                .group
                .as_ref()
                .map(|group| group.id.clone())
                .unwrap_or_else(|| release.id.clone());
            // Check up to two editions per group since track order can vary.
            let count = candidate_groups.entry(group).or_insert(0);
            if *count >= 2 || !checked.insert(release.id.clone()) {
                continue;
            }
            *count += 1;
            let detail: Release = get(
                &client,
                &format!("release/{}", release.id),
                &[
                    ("inc", "recordings+artist-credits+release-groups+genres"),
                    ("fmt", "json"),
                ],
            )
            .await?;
            if let Some(proposal) = draft(&detail, tracks, false, names) {
                let group = detail
                    .group
                    .as_ref()
                    .map(|group| group.id.clone())
                    .unwrap_or_else(|| detail.id.clone());
                matches.push((group, proposal));
            }
            if candidate_groups.len() >= 6 {
                break;
            }
        }
        if !matches.is_empty() {
            break;
        }
    }
    let Some((group, mut best)) = matches.pop() else {
        return Ok(None);
    };
    if matches
        .iter()
        .any(|(other_group, other)| other_group != &group || other.tracks != best.tracks)
    {
        return Ok(None);
    }
    if tracks.iter().any(|track| track.artwork.is_none()) {
        best.cover =
            album_art::match_cover(dir, &best.artist, &best.album, &best.release_id, &group)
                .await
                .unwrap_or(None);
    }
    Ok(Some(best))
}

#[tauri::command]
pub async fn music_match_album(
    app: tauri::AppHandle,
    ids: Vec<i64>,
) -> Result<Option<MatchDraft>, String> {
    let dir = crate::data_dir(&app)?;
    let db_dir = dir.clone();
    let (tracks, names) = crate::jobs::off_main(move || {
        let conn = music_tags::open_library(&db_dir)?;
        Ok((
            music_tags::tracks_by_id(&conn, &ids)?,
            known_artists(&conn)?,
        ))
    })
    .await?;
    search(&dir, &tracks, &names).await
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!(
            "KinemaMediaPersonal/",
            env!("CARGO_PKG_VERSION"),
            " (https://github.com/Basswaves/kinema)"
        ))
        .build()
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct ReleaseChoice {
    id: String,
    album: String,
    artist: String,
    date: String,
    country: String,
    description: String,
    track_count: usize,
}

#[tauri::command]
pub async fn music_search_releases(
    album: String,
    artist: String,
) -> Result<Vec<ReleaseChoice>, String> {
    let album = album.trim();
    let artist = artist.trim();
    if album.is_empty() || album.len() > 512 || artist.len() > 512 {
        return Err("Enter an album title and optionally an artist name.".into());
    }
    let mut query = format!("release:\"{}\"", query_text(album));
    if !artist.is_empty() {
        query.push_str(&format!(" AND artist:\"{}\"", query_text(artist)));
    }
    let response: SearchResult = get(
        &client()?,
        "release/",
        &[("query", &query), ("fmt", "json"), ("limit", "20")],
    )
    .await?;
    Ok(response
        .releases
        .into_iter()
        .filter(|release| valid_id(&release.id))
        .map(|release| ReleaseChoice {
            id: release.id,
            album: release.title,
            artist: credit(&release.artist),
            date: release.date,
            country: release.country,
            description: release.disambiguation,
            track_count: release.track_count,
        })
        .collect())
}

#[derive(Serialize)]
pub struct ReleaseTrackPreview {
    title: String,
    disc: u32,
    track: u32,
}

#[derive(Serialize)]
pub struct ReleasePreview {
    album: String,
    artist: String,
    tracks: Vec<ReleaseTrackPreview>,
    draft: Option<MatchDraft>,
}

#[tauri::command]
pub async fn music_use_release(
    app: tauri::AppHandle,
    ids: Vec<i64>,
    release_id: String,
) -> Result<ReleasePreview, String> {
    if !valid_id(&release_id) {
        return Err("Invalid MusicBrainz release ID.".into());
    }
    let dir = crate::data_dir(&app)?;
    let db_dir = dir.clone();
    let (tracks, names) = crate::jobs::off_main(move || {
        let conn = music_tags::open_library(&db_dir)?;
        Ok((
            music_tags::tracks_by_id(&conn, &ids)?,
            known_artists(&conn)?,
        ))
    })
    .await?;
    let release: Release = get(
        &client()?,
        &format!("release/{release_id}"),
        &[
            ("inc", "recordings+artist-credits+release-groups+genres"),
            ("fmt", "json"),
        ],
    )
    .await?;
    let mut draft = draft(&release, &tracks, true, &names);
    if let Some(proposal) = draft
        .as_mut()
        .filter(|_| tracks.iter().any(|track| track.artwork.is_none()))
    {
        let group = release
            .group
            .as_ref()
            .map(|group| group.id.as_str())
            .unwrap_or("");
        proposal.cover =
            album_art::match_cover(&dir, &proposal.artist, &proposal.album, &release_id, group)
                .await
                .unwrap_or(None);
    }
    Ok(ReleasePreview {
        album: release.title,
        artist: library_credit(&release.artist, &names),
        tracks: release
            .media
            .iter()
            .flat_map(|disc| {
                disc.tracks.iter().map(move |track| ReleaseTrackPreview {
                    title: track.title.clone(),
                    disc: disc.position,
                    track: track.position,
                })
            })
            .collect(),
        draft,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_accepts_medium_summaries_without_positions() {
        let response: SearchResult = serde_json::from_value(serde_json::json!({
            "releases": [{
                "id": "f62157c6-1294-4f24-aabc-34e2a00e31a8",
                "title": "The Very Best",
                "track-count": 18,
                "country": null,
                "release-group": {"id": "example", "first-release-date": null},
                "media": [{"format": "CD", "track-count": 18}]
            }]
        }))
        .unwrap();
        assert_eq!(response.releases[0].title, "The Very Best");
        assert_eq!(response.releases[0].track_count, 18);
    }
}
