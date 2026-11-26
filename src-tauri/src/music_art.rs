//! Artist art from TheAudioDB; cached locally, with conservative matching.
use serde::{Deserialize, Serialize};
use std::{
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri_plugin_http::reqwest;

pub(super) static REQUESTS: tokio::sync::Mutex<Option<Instant>> =
    tokio::sync::Mutex::const_new(None);
const API: &str = "https://www.theaudiodb.com/api/v1/json/123/search.php";

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct ArtistArt {
    pub artist: String,
    #[serde(default)]
    pub gallery: Vec<String>,
    pub background: Option<String>,
    pub thumb: Option<String>,
    pub source: String,
    #[serde(default)]
    pub biography_en: Option<String>,
    #[serde(default)]
    pub biography_ja: Option<String>,
    #[serde(default)]
    pub biography_url: Option<String>,
}
#[derive(Deserialize, Serialize)]
struct Cached {
    #[serde(default)]
    version: u8,
    fetched: i64,
    art: ArtistArt,
}

pub(super) fn normalized(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn selected<'a>(data: &'a serde_json::Value, artist: &str) -> Option<&'a serde_json::Value> {
    let target = normalized(artist);
    if target.is_empty() {
        return None;
    }
    let matches: Vec<_> = data
        .get("artists")?
        .as_array()?
        .iter()
        .filter(|item| {
            ["strArtist", "strArtistAlternate"].iter().any(|key| {
                item.get(key)
                    .and_then(|v| v.as_str())
                    .is_some_and(|name| name.split(';').any(|alias| normalized(alias) == target))
            })
        })
        .collect();
    (matches.len() == 1).then(|| matches[0])
}
pub(super) fn image_url(value: &serde_json::Value, key: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(value.get(key)?.as_str()?).ok()?;
    (url.scheme() == "https"
        && matches!(
            url.host_str(),
            Some("www.theaudiodb.com" | "theaudiodb.com" | "r2.theaudiodb.com")
        )
        && url.port().is_none())
    .then_some(url)
}
pub(super) async fn bytes(response: reqwest::Response, maximum: usize) -> Result<Vec<u8>, String> {
    let mut response = response.error_for_status().map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if result.len() + chunk.len() > maximum {
            return Err("TheAudioDB response is too large.".into());
        }
        result.extend_from_slice(&chunk);
    }
    Ok(result)
}
pub(super) async fn picture(
    client: &reqwest::Client,
    url: reqwest::Url,
    dest: PathBuf,
) -> Result<String, String> {
    let data = bytes(
        client.get(url).send().await.map_err(|e| e.to_string())?,
        8 * 1024 * 1024,
    )
    .await?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut reader = image::ImageReader::new(std::io::Cursor::new(data))
            .with_guessed_format()
            .map_err(|e| e.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        let image = reader.decode().map_err(|e| e.to_string())?;
        let temp = dest.with_extension("part.jpg");
        image
            .thumbnail(1600, 900)
            .to_rgb8()
            .save(&temp)
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temp, &dest).map_err(|e| e.to_string())?;
        Ok(dest.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn musical_summary(data: &serde_json::Value, artist: &str) -> Option<(String, String)> {
    if data.get("type").and_then(|v| v.as_str()) == Some("disambiguation") {
        return None;
    }
    let title = data.get("title")?.as_str()?;
    if normalized(title.split(" (").next().unwrap_or(title)) != normalized(artist) {
        return None;
    }
    let text = data.get("extract")?.as_str()?.trim();
    let lower = text.to_lowercase();
    if text.is_empty()
        || ![
            "singer",
            "musician",
            "band",
            "rapper",
            "songwriter",
            "composer",
            "music duo",
            "musical group",
        ]
        .iter()
        .any(|word| lower.contains(word))
    {
        return None;
    }
    let url = data.pointer("/content_urls/desktop/page")?.as_str()?;
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "https" || parsed.host_str()? != "en.wikipedia.org" {
        return None;
    }
    Some((text.chars().take(20000).collect(), url.to_owned()))
}
async fn english_biography(client: &reqwest::Client, artist: &str) -> Option<(String, String)> {
    for title in [
        format!("{artist} (singer)"),
        format!("{artist} (band)"),
        artist.to_owned(),
    ] {
        let mut url =
            reqwest::Url::parse("https://en.wikipedia.org/api/rest_v1/page/summary/").ok()?;
        url.path_segments_mut().ok()?.pop_if_empty().push(&title);
        let Ok(response) = client.get(url).send().await else {
            continue;
        };
        let Ok(body) = bytes(response, 1024 * 1024).await else {
            continue;
        };
        let Ok(data) = serde_json::from_slice::<serde_json::Value>(&body) else {
            continue;
        };
        if let Some(bio) = musical_summary(&data, artist) {
            return Some(bio);
        }
    }
    None
}

fn read_cache(path: &Path) -> Option<Cached> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}
fn usable(art: &mut ArtistArt) {
    art.gallery.retain(|p| Path::new(p).is_file());
    for p in [&art.background, &art.thumb].into_iter().flatten() {
        if Path::new(p).is_file() && !art.gallery.contains(p) {
            art.gallery.push(p.clone());
        }
    }
    if art
        .background
        .as_ref()
        .is_some_and(|p| !Path::new(p).is_file())
    {
        art.background = None;
    }
    if art.thumb.as_ref().is_some_and(|p| !Path::new(p).is_file()) {
        art.thumb = None;
    }
}

#[tauri::command]
pub async fn music_artist_art(
    app: tauri::AppHandle,
    artist: String,
    refresh: bool,
) -> Result<ArtistArt, String> {
    lookup(crate::data_dir(&app)?, artist, refresh).await
}
async fn lookup(dir: PathBuf, artist: String, refresh: bool) -> Result<ArtistArt, String> {
    lookup_cancellable(dir, artist, refresh, None).await
}
pub(super) async fn lookup_cancellable(
    dir: PathBuf,
    artist: String,
    refresh: bool,
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> Result<ArtistArt, String> {
    let artist = artist.trim().to_owned();
    if artist.is_empty() || artist.len() > 500 {
        return Ok(ArtistArt::default());
    }
    let cache = dir.join("music-artists");
    let pictures = dir.join("artwork");
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&pictures).map_err(|e| e.to_string())?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    normalized(&artist).hash(&mut hash);
    let id = format!("artist-{:016x}", hash.finish());
    let path = cache.join(format!("{id}.json"));
    let cached = read_cache(&path);
    // Cache first, including offline use. Missing matches expire after one day.
    if !refresh {
        if let Some(ref saved) = cached {
            if saved.version >= 4 {
                let mut art = saved.art.clone();
                usable(&mut art);
                if art.background.is_some()
                    || art.thumb.is_some()
                    || (saved.art.background.is_none()
                        && saved.art.thumb.is_none()
                        && crate::util::now_secs() - saved.fetched < 86400)
                {
                    return Ok(art);
                }
            }
        }
    }
    let mut gate = REQUESTS.lock().await;
    if let Some(last) = *gate {
        tokio::time::sleep(Duration::from_millis(2100).saturating_sub(last.elapsed())).await;
    }
    *gate = Some(Instant::now());
    if cancel.is_some_and(|c| c.load(std::sync::atomic::Ordering::Acquire)) {
        return Err("Artwork search cancelled".into());
    }
    let client = crate::net::client(crate::net::Service::MusicMetadata)?
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Kinema-Music/0.15.2 personal artist artwork")
        .build()
        .map_err(|e| e.to_string())?;
    let result: Result<ArtistArt, String> = async {
        let response = client
            .get(API)
            .query(&[("s", &artist)])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let data: serde_json::Value = serde_json::from_slice(&bytes(response, 1024 * 1024).await?)
            .map_err(|e| e.to_string())?;
        if data.get("artists").is_none() {
            return Err("Unexpected artist response; try again later.".into());
        }
        let mut art = ArtistArt {
            artist: artist.clone(),
            source: "TheAudioDB".into(),
            ..ArtistArt::default()
        };
        if let Some(item) = selected(&data, &artist) {
            let biography = |key: &str| {
                item.get(key)
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(|v| v.chars().take(20000).collect::<String>())
            };
            art.biography_en = biography("strBiographyEN");
            art.biography_ja = biography("strBiographyJP");
            let mut failed = None;
            let mut seen = std::collections::HashSet::new();
            for (index, key) in [
                "strArtistFanart",
                "strArtistFanart2",
                "strArtistFanart3",
                "strArtistFanart4",
                "strArtistWideThumb",
                "strArtistThumb",
            ]
            .iter()
            .enumerate()
            {
                if cancel.is_some_and(|c| c.load(std::sync::atomic::Ordering::Acquire)) {
                    return Err("Artwork search cancelled".into());
                }
                if let Some(url) = image_url(item, key) {
                    if !seen.insert(url.to_string()) {
                        continue;
                    }
                    let dest = pictures.join(format!("{id}-image-{index}.jpg"));
                    let image = if !refresh && dest.is_file() {
                        Ok(dest.to_string_lossy().into_owned())
                    } else {
                        picture(&client, url, dest).await
                    };
                    match image {
                        Ok(path) => {
                            if *key == "strArtistThumb" {
                                art.thumb = Some(path.clone());
                            } else if art.background.is_none() {
                                art.background = Some(path.clone());
                            }
                            art.gallery.push(path);
                        }
                        Err(e) => failed = Some(e),
                    }
                }
            }
            if art.background.is_none() && art.thumb.is_none() {
                if let Some(error) = failed {
                    return Err(error);
                }
            }
        }
        if art.biography_en.is_none() {
            if let Some((text, url)) = english_biography(&client, &artist).await {
                art.biography_en = Some(text);
                art.biography_url = Some(url);
            }
        }
        Ok(art)
    }
    .await;
    match result {
        Ok(art) => {
            let json = serde_json::to_vec(&Cached {
                version: 4,
                fetched: crate::util::now_secs(),
                art: art.clone(),
            })
            .map_err(|e| e.to_string())?;
            let temp = path.with_extension("part");
            std::fs::write(&temp, json)
                .and_then(|_| std::fs::rename(temp, path))
                .map_err(|e| e.to_string())?;
            Ok(art)
        }
        Err(error) => {
            if let Some(mut old) = cached {
                usable(&mut old.art);
                Ok(old.art)
            } else {
                Err(format!("TheAudioDB: {error}"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn english_summary_rejects_unrelated_and_ambiguous_pages() {
        let mut data=serde_json::json!({"type":"standard","title":"Anri","extract":"Anri is a Japanese singer and songwriter.","content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/Anri"}}});
        assert!(musical_summary(&data,"Anri").is_some());
        assert!(musical_summary(&data,"Other").is_none());
        data["type"]=serde_json::json!("disambiguation");
        assert!(musical_summary(&data,"Anri").is_none());
    }
    #[test]
    fn legacy_art_cache_remains_readable_without_biographies() {
        let saved: Cached=serde_json::from_value(serde_json::json!({"version":2,"fetched":1,"art":{"artist":"Anri","gallery":[],"thumb":null,"background":null,"source":"TheAudioDB"}})).unwrap();
        assert!(saved.art.biography_en.is_none());
        assert!(saved.art.biography_ja.is_none());
    }
    #[test]
    fn matches_unicode_aliases_and_rejects_ambiguity() {
        let data =
            serde_json::json!({"artists":[{"strArtist":"Anri", "strArtistAlternate":"杏里"}]});
        assert!(selected(&data, "杏里").is_some());
        assert!(selected(&data, "ANRI").is_some());
        assert!(selected(&data, "Other").is_none());
        let slash_name = serde_json::json!({"artists":[{"strArtist":"AC/DC"}]});
        assert!(selected(&slash_name, "AC/DC").is_some());
        assert!(selected(&slash_name, "AC").is_none());
        let ambiguous = serde_json::json!({"artists":[{"strArtist":"Anri"},{"strArtist":"Anri"}]});
        assert!(selected(&ambiguous, "Anri").is_none());
    }
    #[test]
    #[ignore = "live TheAudioDB request; run explicitly"]
    fn live_artist_download_and_cache() {
        tauri::async_runtime::block_on(async {
            let dir =
                std::env::temp_dir().join(format!("kinema-art-check-{}", crate::util::now_secs()));
            let art = lookup(dir.clone(), "Anri".into(), false)
                .await
                .expect("live API and image request");
            assert!(art.thumb.as_ref().is_some_and(|p| Path::new(p).is_file()));
            assert!(art.biography_en.as_ref().is_some_and(|text| text.contains("singer")));
            // A valid cached request must return without even entering the network gate.
            let _gate = REQUESTS.lock().await;
            let cached = tokio::time::timeout(
                Duration::from_millis(200),
                lookup(dir, "Anri".into(), false),
            )
            .await
            .expect("cache should not access network")
            .unwrap();
            assert_eq!(art.thumb, cached.thumb);
        });
    }
    #[test]
    fn artwork_urls_stay_on_provider_https_hosts() {
        for url in [
            "http://r2.theaudiodb.com/a.jpg",
            "https://evil.test/a.jpg",
            "https://r2.theaudiodb.com.evil.test/a.jpg",
        ] {
            assert!(image_url(&serde_json::json!({"art":url}), "art").is_none());
        }
        assert!(image_url(
            &serde_json::json!({"art":"https://r2.theaudiodb.com/a.jpg"}),
            "art"
        )
        .is_some());
    }
}
