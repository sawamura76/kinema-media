//! The proxy setting (Settings → Privacy, "Send Skrin's lookups through a
//! proxy"): one place every Rust HTTP client of Skrin starts from.
//!
//! Off by default. When on, `builder()` sends the client through the address
//! the user gave (HTTP(S) or SOCKS5 — a VPN's or Tor's local proxy). It never
//! falls back to a direct connection: an address that cannot be used makes
//! every request fail, and the page says so (Settings → Privacy, "Check").
//! Addresses on this computer or the home network are not sent through it:
//! the proxy is for what reaches the internet, and a proxy cannot reach a
//! NAS or a trailer relay on 127.0.0.1.
//!
//! The page's own requests follow too: `tauri-plugin-http`'s `fetch` is given
//! the same address by the page (`src/net/proxy.ts`), and a picture from the
//! internet is fetched here (`fetch_remote_image`) instead of by the webview,
//! which has no proxy of its own. What slips past is the YouTube trailer
//! (an iframe in the webview) — the Settings text says so.

//!
//! It is also the one gate of "Keep everything on this computer" (Settings →
//! Privacy; PRIVATE-MODE.md §2): every client is made by `client(service)`,
//! which names the service it is for (the ids of `src/trust/whatLeaves.json`)
//! and is refused while the mode is on, except IMDb's two files, each while
//! its own setting allows it, and the user's own media server. The page asks
//! the same question (`offline_current`, `src/net/offline.ts`) before its own
//! requests and before loading a picture from the internet.

use std::sync::RwLock;
use tauri_plugin_http::reqwest::{ClientBuilder, NoProxy, Proxy, Url};

/// The two settings, in the `settings` table.
pub const ENABLED_KEY: &str = "proxy_enabled";
pub const ADDRESS_KEY: &str = "proxy_address";

/// "Keep everything on this computer": "1" = on (imdbOffline.ts `OFFLINE_KEY`).
pub const OFFLINE_KEY: &str = "keep_on_device";
/// In the mode, IMDb's ratings file: "0" = off. On by default.
pub const IMDB_RATINGS_KEY: &str = "imdb_ratings_allowed";

/// Every service Skrin can talk to, as `whatLeaves.json` names them.
/// Wikidata and OMDb are asked by the page only (`src/net/offline.ts` gates
/// them there); they are named here so the list is whole.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub enum Service {
    Tmdb,
    Tvmaze,
    Wikidata,
    Omdb,
    ImdbRatings,
    ImdbTitles,
    TheIntroDb,
    IntroDbApp,
    OpenSubtitles,
    Simkl,
    Trakt,
    /// The user's own Jellyfin, Emby or Plex: the address is theirs.
    OwnServer,
    Winget,
    Youtube,
    Github,
    MusicMetadata,
}

/// What a refused request says (and what `userError` shows).
pub const KEPT_HERE: &str =
    "Keep everything on this computer is on, so Skrin does not ask the internet for this.";

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Privacy {
    offline: bool,
    imdb_ratings: bool,
    imdb_titles: bool,
}

static PRIVACY: RwLock<Privacy> =
    RwLock::new(Privacy { offline: false, imdb_ratings: true, imdb_titles: false });

fn privacy() -> Privacy {
    PRIVACY.read().map(|p| *p).unwrap_or_default()
}

/// The settings `reload` reads; a change to one of them is applied at once.
pub fn is_network_setting(key: &str) -> bool {
    [ENABLED_KEY, ADDRESS_KEY, OFFLINE_KEY, IMDB_RATINGS_KEY, crate::imdb_titles::ALLOWED_KEY]
        .contains(&key)
}

/// Whether "Keep everything on this computer" is on.
pub fn offline() -> bool {
    privacy().offline
}

/// The gate: may Skrin talk to `service` now? In the mode, only IMDb's two
/// files (each by its own setting) and the user's own server. Outside it,
/// everything as before, but IMDb's list of titles, which is only for the
/// mode.
pub fn allowed(service: Service) -> Result<(), String> {
    let p = privacy();
    let ok = match service {
        Service::ImdbTitles => p.offline && p.imdb_titles,
        Service::ImdbRatings => !p.offline || p.imdb_ratings,
        Service::OwnServer => true,
        _ => !p.offline,
    };
    if ok {
        Ok(())
    } else {
        crate::log!("network: {service:?} not asked (Keep everything on this computer)");
        Err(KEPT_HERE.into())
    }
}

/// A client builder for `service`, through the proxy when it is on; refused
/// while the mode keeps that service off. The only way to a client.
pub fn client(service: Service) -> Result<ClientBuilder, String> {
    allowed(service)?;
    Ok(builder())
}

/// What the page needs of the gate.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offline {
    pub offline: bool,
    pub imdb_ratings: bool,
    pub imdb_titles: bool,
}

#[tauri::command]
pub fn offline_current() -> Offline {
    let p = privacy();
    Offline { offline: p.offline, imdb_ratings: p.imdb_ratings, imdb_titles: p.imdb_titles }
}

/// Not sent through the proxy: this computer and the home network.
const LOCAL: &str =
    "localhost,127.0.0.0/8,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,*.local";

/// Where the address points when the setting is on but no address can be
/// used: nothing answers there, so a request fails instead of going direct.
const DEAD_END: &str = "http://127.0.0.1:9";

#[derive(Clone, Debug, PartialEq)]
enum State {
    Off,
    On(String),
    /// On, but the address is empty or unusable: requests fail.
    Broken,
}

static STATE: RwLock<State> = RwLock::new(State::Off);

/// An address as the user may type it, made into one reqwest takes.
/// `host:port` is an HTTP proxy; `http://`, `https://`, `socks5://` and
/// `socks5h://` (the proxy looks names up) are kept. A port is required.
pub fn normalise(text: &str) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err(
            "Type the proxy's address first, such as 127.0.0.1:9050 or socks5://127.0.0.1:9050."
                .into(),
        );
    }
    let with_scheme = if text.contains("://") { text.to_string() } else { format!("http://{text}") };
    let url = Url::parse(&with_scheme).map_err(|_| {
        "That is not an address a proxy can have. Try 127.0.0.1:8080 or socks5://127.0.0.1:9050."
            .to_string()
    })?;
    if !matches!(url.scheme(), "http" | "https" | "socks5" | "socks5h") {
        return Err(format!(
            "A proxy address starts with http://, https://, socks5:// or socks5h://, not {}://.",
            url.scheme()
        ));
    }
    if url.host_str().is_none_or(str::is_empty) || url.port().is_none() {
        return Err("The proxy's address needs a host and a port, such as 127.0.0.1:8080.".into());
    }
    Ok(url.to_string().trim_end_matches('/').to_string())
}

/// Read the settings and use them from now on.
pub fn reload(conn: &rusqlite::Connection) {
    let get = |key| crate::settings::setting(conn, key);
    let privacy = Privacy {
        offline: get(OFFLINE_KEY).as_deref() == Some("1"),
        imdb_ratings: get(IMDB_RATINGS_KEY).as_deref() != Some("0"),
        imdb_titles: get(crate::imdb_titles::ALLOWED_KEY).as_deref() == Some("1"),
    };
    if privacy != self::privacy() {
        crate::log!(
            "network: keep everything on this computer {}{}",
            if privacy.offline { "on" } else { "off" },
            if privacy.offline {
                format!(
                    " (IMDb ratings {}, list of titles {})",
                    if privacy.imdb_ratings { "on" } else { "off" },
                    if privacy.imdb_titles { "on" } else { "off" }
                )
            } else {
                String::new()
            }
        );
    }
    if let Ok(mut now) = PRIVACY.write() {
        *now = privacy;
    }
    let on = crate::settings::setting(conn, ENABLED_KEY).is_some_and(|v| v == "on");
    let state = if !on {
        State::Off
    } else {
        match crate::settings::setting(conn, ADDRESS_KEY).map(|a| normalise(&a)) {
            Some(Ok(address)) => State::On(address),
            _ => State::Broken,
        }
    };
    crate::log!(
        "proxy: {}",
        match &state {
            State::Off => "off",
            State::On(_) => "on",
            State::Broken => "on, but the address cannot be used (requests fail)",
        }
    );
    if let Ok(mut now) = STATE.write() {
        *now = state;
    }
}

fn state() -> State {
    STATE.read().map(|s| s.clone()).unwrap_or(State::Off)
}

/// A client builder: through the proxy when it is on, as before when it is not.
/// Private: callers go through `client(service)`, which asks the gate first.
fn builder() -> ClientBuilder {
    let builder = tauri_plugin_http::reqwest::Client::builder();
    match state() {
        State::Off => builder,
        State::On(address) => through(builder, &address),
        State::Broken => through(builder, DEAD_END),
    }
}

fn through(builder: ClientBuilder, address: &str) -> ClientBuilder {
    match Proxy::all(address) {
        Ok(proxy) => builder.proxy(proxy.no_proxy(NoProxy::from_string(LOCAL))),
        // Cannot happen for an address `normalise` passed; never direct if it does.
        Err(_) => builder.proxy(Proxy::all(DEAD_END).expect("a fixed address")),
    }
}

/// What the page's own `fetch` needs: whether to use a proxy and which. A
/// broken address is the dead end, so the page's requests fail too.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Current {
    pub enabled: bool,
    pub address: String,
    /// Addresses the page's `fetch` leaves out of the proxy (`LOCAL`).
    pub no_proxy: &'static str,
}

#[tauri::command]
pub fn proxy_current() -> Current {
    match state() {
        State::Off => Current { enabled: false, address: String::new(), no_proxy: LOCAL },
        State::On(address) => Current { enabled: true, address, no_proxy: LOCAL },
        State::Broken => Current { enabled: true, address: DEAD_END.to_string(), no_proxy: LOCAL },
    }
}

/// The "Check" button: TMDB's API asked once through the address typed (on or
/// not yet), and what happened in a sentence. Never direct: a client that
/// cannot be built through the address says so.
#[tauri::command]
pub async fn check_proxy(address: String) -> Result<String, String> {
    allowed(Service::Tmdb)?;
    let address = normalise(&address)?;
    let client = through(tauri_plugin_http::reqwest::Client::builder(), &address)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    match client.get("https://api.themoviedb.org/").send().await {
        Ok(response) => {
            crate::log!("proxy: check reached TMDB, HTTP {}", response.status().as_u16());
            Ok("The proxy works: TMDB answered through it.".into())
        }
        Err(e) => {
            let mut chain = e.to_string();
            let mut source = std::error::Error::source(&e);
            while let Some(s) = source {
                chain.push_str(" <- ");
                chain.push_str(&s.to_string());
                source = s.source();
            }
            let cause = crate::reach::classify(&chain, e.is_timeout());
            crate::log!("proxy: check failed ({cause}): {chain}");
            let lower = chain.to_lowercase();
            if lower.contains("tunnel error") {
                return Err("The proxy answered but would not pass the connection on to TMDB. Its own rules may block it.".into());
            }
            if lower.contains("socks") {
                return Err("The SOCKS5 proxy could not make the connection to TMDB, or did not speak SOCKS5.".into());
            }
            Err(match cause {
                "refused" => "The proxy did not accept the connection. Is it running, at that address and port?",
                "timeout" => "The proxy, or the network behind it, did not answer in time.",
                "dns" => "The proxy could not look up TMDB's name, or its own address could not be found.",
                "tls" => "The secure connection to TMDB through the proxy failed. A proxy that opens secure connections itself cannot be used.",
                "cut" => "The proxy cut the connection. It may not be an HTTP or SOCKS5 proxy, or the type in front of the address is wrong.",
                _ => "TMDB could not be reached through the proxy.",
            }
            .into())
        }
    }
}

/// The address as it will be used, or why it cannot be.
#[tauri::command]
pub fn proxy_normalise(address: String) -> Result<String, String> {
    normalise(&address)
}

/// A picture from the internet, fetched here so that it goes where the
/// proxy sends it; the webview would load it direct. https only, and no
/// bigger than artwork is.
#[tauri::command]
pub async fn fetch_remote_image(url: String) -> Result<tauri::ipc::Response, String> {
    const MAX: usize = 16 * 1024 * 1024;
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" {
        return Err("only https pictures".into());
    }
    // Pictures come from TMDB or TVmaze; in the mode, neither is asked.
    let service = if parsed.host_str().is_some_and(|h| h.contains(".tvmaze.")) {
        Service::Tvmaze
    } else {
        Service::Tmdb
    };
    let client = client(service)?
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("Skrin/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(parsed).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("the server answered {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX {
        return Err("picture too large".into());
    }
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_are_made_usable_or_refused_in_words() {
        assert_eq!(normalise("127.0.0.1:8080").unwrap(), "http://127.0.0.1:8080");
        assert_eq!(normalise(" socks5://127.0.0.1:9050/ ").unwrap(), "socks5://127.0.0.1:9050");
        assert_eq!(normalise("socks5h://localhost:9150").unwrap(), "socks5h://localhost:9150");
        assert!(normalise("").is_err());
        assert!(normalise("127.0.0.1").unwrap_err().contains("port"));
        assert!(normalise("ftp://host:21").unwrap_err().contains("starts with"));
        assert!(normalise("not an address").is_err());
    }

    #[test]
    fn the_mode_lets_only_imdb_and_the_own_server_through() {
        let all = [
            Service::Tmdb,
            Service::Tvmaze,
            Service::Wikidata,
            Service::Omdb,
            Service::TheIntroDb,
            Service::IntroDbApp,
            Service::OpenSubtitles,
            Service::Simkl,
            Service::Trakt,
            Service::Winget,
            Service::Youtube,
            Service::Github,
            Service::MusicMetadata,
        ];
        let set = |p: Privacy| *PRIVACY.write().unwrap() = p;
        set(Privacy { offline: true, imdb_ratings: true, imdb_titles: true });
        for s in all {
            assert_eq!(allowed(s).unwrap_err(), KEPT_HERE, "{s:?}");
            assert!(client(s).is_err());
        }
        assert!(allowed(Service::ImdbRatings).is_ok());
        assert!(allowed(Service::ImdbTitles).is_ok());
        assert!(allowed(Service::OwnServer).is_ok());
        // Each IMDb file has its own off; both off is fully offline.
        set(Privacy { offline: true, imdb_ratings: false, imdb_titles: false });
        assert!(allowed(Service::ImdbRatings).is_err());
        assert!(allowed(Service::ImdbTitles).is_err());
        // Outside the mode: everything as before, but the list (mode only),
        // and the ratings file's off means nothing there.
        set(Privacy { offline: false, imdb_ratings: false, imdb_titles: true });
        for s in all {
            assert!(allowed(s).is_ok(), "{s:?}");
        }
        assert!(allowed(Service::ImdbRatings).is_ok());
        assert!(allowed(Service::ImdbTitles).is_err());
        set(Privacy { offline: false, imdb_ratings: true, imdb_titles: false });
    }

    #[test]
    fn a_broken_address_never_goes_direct() {
        *STATE.write().unwrap() = State::Broken;
        assert_eq!(proxy_current().address, DEAD_END);
        assert!(proxy_current().enabled);
        *STATE.write().unwrap() = State::Off;
        assert!(!proxy_current().enabled);
    }
}
