//! Whether a newer Kinema Media has been released, and the one-press update.
//!
//! The check asks GitHub for the latest release, once per launch: a failure of
//! any kind — offline, rate limited, a response that no longer parses — is
//! simply "nothing to say", so if GitHub ever changes the notice goes quiet and
//! nothing breaks. Settings can switch it off; the frontend does not call this
//! then.
//!
//! The update itself happens only when the user presses "Update to Kinema Media X"
//! (never silently, never on its own: "automatic updates stay out" holds). It
//! downloads the same kind of file this copy was installed from, checks it
//! against the release's own `.sha256`, and hands it to the system's own
//! installer, which asks the user before anything changes:
//! - Windows, installed with the setup (an `uninstall.exe` beside the program):
//!   the setup is started and Kinema Media closes so it can be replaced.
//! - Linux, a .deb or .rpm the system's package database says owns this
//!   program, with `pkexec` and `apt-get` / `dnf` present: the package goes to
//!   `pkexec apt-get|dnf install`, which asks for the password.
//! - Android: the APK goes to Android's own installer (UpdatePlugin.kt).
//!
//! Anything else — the Windows ZIP, a tar.gz, a system that does not answer as
//! expected — gets the download page, as before (fail safe).
//!
//! For tests only, `SKRIN_UPDATE_FEED` (desktop) or the system property
//! `debug.skrin.update_feed` (Android) names a release on this machine's own
//! loopback address in GitHub's shape; nothing else is accepted.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const LATEST: &str = "https://api.github.com/repos/sawamura76/kinema-media/releases/latest";
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(6);

#[derive(Serialize, Debug, PartialEq)]
pub struct Release {
    pub version: String,
    /// The release page, for the "download it" button.
    pub url: String,
    /// Set when this copy can update itself with one press: what is fetched
    /// ("setup", "deb", "rpm", "apk"). None → the download page.
    pub install: Option<&'static str>,
}

#[derive(Deserialize, Clone)]
struct Asset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize, Clone)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<Asset>,
}

/// The release last found newer, for the update button.
static FOUND: Mutex<Option<GithubRelease>> = Mutex::new(None);

/// `v0.3.10` → `[0, 3, 10]`. Anything after a `-` (a pre-release label) is
/// ignored, and a part that is not a number ends the version there.
fn parts(version: &str) -> Vec<u64> {
    version
        .trim()
        .trim_start_matches(['v', 'V'])
        .split('-')
        .next()
        .unwrap_or("")
        .split('.')
        .map_while(|p| p.parse().ok())
        .collect()
}

/// Whether `latest` is a later version than `current`, compared numerically —
/// so 0.3.10 is newer than 0.3.9, which comparing strings gets wrong.
pub fn is_newer(current: &str, latest: &str) -> bool {
    let (a, b) = (parts(current), parts(latest));
    if b.is_empty() {
        return false;
    }
    let len = a.len().max(b.len());
    for i in 0..len {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if y != x {
            return y > x;
        }
    }
    false
}

/// Whether a URL points at this machine's own loopback address.
fn is_loopback(url: &str) -> bool {
    let rest = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://"));
    let host = rest.and_then(|r| r.split(['/', '?']).next()).unwrap_or("");
    let host = host.rsplit_once(':').map_or(host, |(h, port)| {
        if port.chars().all(|c| c.is_ascii_digit()) { h } else { host }
    });
    matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

/// The test release, when one is named and on loopback.
fn test_feed() -> Option<String> {
    #[cfg(target_os = "android")]
    let named = std::process::Command::new("getprop")
        .arg("debug.skrin.update_feed")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned());
    #[cfg(not(target_os = "android"))]
    let named = std::env::var("SKRIN_UPDATE_FEED").ok();
    let named = named.filter(|s| !s.is_empty())?;
    if is_loopback(&named) {
        crate::log!("updates: test release at {named}");
        Some(named)
    } else {
        crate::log!("updates: ignoring a test release that is not on this machine: {named}");
        None
    }
}

/// Where a release's file may be downloaded from: GitHub over https, or the
/// loopback test release.
fn allowed_download(url: &str, testing: bool) -> bool {
    url.starts_with("https://github.com/") || (testing && is_loopback(url))
}

/// What this copy can update itself with, from how it was installed. None
/// when that cannot be told safely.
fn install_kind() -> Option<&'static str> {
    #[cfg(windows)]
    {
        // The setup leaves its uninstaller beside the program; the ZIP has none.
        let exe = std::env::current_exe().ok()?;
        exe.parent()?.join("uninstall.exe").is_file().then_some("setup")
    }
    #[cfg(target_os = "linux")]
    {
        let exe = std::env::current_exe().ok()?;
        let answers = |program: &str, args: &[&std::ffi::OsStr]| {
            std::process::Command::new(program)
                .args(args)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|s| s.success())
        };
        let on_path = |program: &str| {
            std::env::var_os("PATH").is_some_and(|p| {
                std::env::split_paths(&p).any(|d| d.join(program).is_file())
            })
        };
        if !on_path("pkexec") {
            return None;
        }
        let exe = exe.as_os_str();
        if on_path("dpkg-query") && on_path("apt-get") && answers("dpkg-query", &["-S".as_ref(), exe]) {
            return Some("deb");
        }
        if on_path("rpm") && on_path("dnf") && answers("rpm", &["-qf".as_ref(), exe]) {
            return Some("rpm");
        }
        None
    }
    #[cfg(target_os = "android")]
    {
        Some("apk")
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
    {
        None
    }
}

/// The release's file for this kind of copy, named as release.yml names it.
fn asset_name(kind: &str) -> Option<String> {
    let arch = std::env::consts::ARCH;
    Some(match kind {
        "setup" => "kinema-media-windows-x64-setup.exe".into(),
        "apk" => "kinema-media-android.apk".into(),
        "deb" => format!(
            "kinema-media-linux-{}.deb",
            match arch {
                "x86_64" => "amd64",
                "aarch64" => "arm64",
                _ => return None,
            }
        ),
        "rpm" => match arch {
            "x86_64" | "aarch64" => format!("kinema-media-linux-{arch}.rpm"),
            _ => return None,
        },
        _ => return None,
    })
}

/// The file and its checksum, when the release has both and they may be
/// downloaded from where they are.
fn files_for<'a>(release: &'a GithubRelease, kind: &str, testing: bool) -> Option<(&'a Asset, &'a Asset)> {
    let name = asset_name(kind)?;
    let sum_name = format!("{name}.sha256");
    let file = release.assets.iter().find(|a| a.name == name)?;
    let sum = release.assets.iter().find(|a| a.name == sum_name)?;
    (allowed_download(&file.browser_download_url, testing)
        && allowed_download(&sum.browser_download_url, testing))
    .then_some((file, sum))
}

fn client() -> Option<tauri_plugin_http::reqwest::Client> {
    crate::net::client(crate::net::Service::Github)
        .ok()?
        .connect_timeout(TIMEOUT)
        // GitHub refuses API requests without one.
        .user_agent(concat!("Kinema Media/", env!("CARGO_PKG_VERSION")))
        .build()
        .ok()
}

/// The latest release, if it is newer than this build; otherwise `None`.
#[tauri::command]
pub async fn latest_release() -> Option<Release> {
    let client = client()?;
    let feed = test_feed();
    let response = match client.get(feed.as_deref().unwrap_or(LATEST)).timeout(TIMEOUT).send().await {
        Ok(r) => r,
        Err(e) => {
            crate::log!("updates: could not ask GitHub: {e}");
            return None;
        }
    };
    if !response.status().is_success() {
        crate::log!("updates: GitHub answered {}", response.status());
        return None;
    }
    let body = response.text().await.ok()?;
    let release: GithubRelease = match serde_json::from_str(&body) {
        Ok(r) => r,
        Err(e) => {
            crate::log!("updates: could not read GitHub's answer: {e}");
            return None;
        }
    };
    if release.draft || release.prerelease {
        return None;
    }

    let current = env!("CARGO_PKG_VERSION");
    if !is_newer(current, &release.tag_name) {
        return None;
    }
    let install = install_kind().filter(|k| files_for(&release, k, feed.is_some()).is_some());
    crate::log!(
        "updates: {} is out; this is {current}; {}",
        release.tag_name,
        install.map_or("the download page".to_owned(), |k| format!("can update itself ({k})"))
    );
    let found = Release {
        version: release.tag_name.trim_start_matches(['v', 'V']).to_owned(),
        url: release.html_url.clone(),
        install,
    };
    *FOUND.lock().unwrap_or_else(|e| e.into_inner()) = Some(release);
    Some(found)
}

#[derive(Serialize, Clone)]
struct Progress {
    done: u64,
    total: Option<u64>,
}

/// The first 64 hex characters of a `.sha256` file (`<hash>  <name>`).
fn expected_sum(text: &str) -> Option<String> {
    let hash = text.split_whitespace().next()?.to_ascii_lowercase();
    (hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit())).then_some(hash)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Downloads `url` into `path`, saying how far it got, and returns its SHA-256.
async fn download(
    app: &tauri::AppHandle,
    client: &tauri_plugin_http::reqwest::Client,
    url: &str,
    path: &std::path::Path,
) -> Result<String, String> {
    use sha2::Digest;
    use std::io::Write;
    use tauri::Emitter;
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("The download did not start: {e}"))?;
    let total = response.content_length();
    let mut file = std::fs::File::create(path).map_err(|e| format!("Could not save the download: {e}"))?;
    let mut hasher = sha2::Sha256::new();
    let (mut done, mut said) = (0u64, 0u64);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("The download stopped: {e}"))?
    {
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| format!("Could not save the download: {e}"))?;
        done += chunk.len() as u64;
        // About a hundred updates for the whole file, not one per chunk.
        if done - said >= total.unwrap_or(4_000_000) / 100 {
            said = done;
            let _ = app.emit("update-progress", Progress { done, total });
        }
    }
    file.sync_all().map_err(|e| format!("Could not save the download: {e}"))?;
    let _ = app.emit("update-progress", Progress { done, total });
    Ok(hex(&hasher.finalize()))
}

/// What happened when the update was handed over.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Handed {
    /// "closing" (Windows: the setup is open, Kinema Media closes), "installed"
    /// (Linux: restart to use it), "opened" (Android: its installer is open),
    /// "permission" (Android: allow installing apps first, then press again).
    state: &'static str,
}

/// Downloads the newer release found by `latest_release`, checks it, and hands
/// it to the system's installer. Only on the user's press.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<Handed, String> {
    use tauri::Manager;
    let release = FOUND
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .ok_or("No newer version was found this time Kinema Media started.")?;
    let kind = install_kind().ok_or("This copy of Kinema Media cannot update itself; use the download page.")?;
    let testing = test_feed().is_some();
    let (file, sum) = files_for(&release, kind, testing).ok_or("The release has no file for this copy.")?;
    let client = client().ok_or("Could not start a download.")?;

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("update");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not make a folder for the download: {e}"))?;
    let path = dir.join(&file.name);

    let sum_text = client
        .get(&sum.browser_download_url)
        .timeout(TIMEOUT)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Could not fetch the checksum: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Could not fetch the checksum: {e}"))?;
    let want = expected_sum(&sum_text).ok_or("The release's checksum file could not be read.")?;
    crate::log!("updates: downloading {} ({})", file.name, release.tag_name);
    let got = download(&app, &client, &file.browser_download_url, &path).await?;
    if got != want {
        let _ = std::fs::remove_dir_all(&dir);
        crate::log!("updates: checksum mismatch for {}: expected {want}, got {got}", file.name);
        return Err("The download did not match the release's checksum, so it was deleted. Nothing was installed.".into());
    }
    crate::log!("updates: {} checked ({got}); handing it to the installer", file.name);
    hand_over(&app, kind, &path).await
}

#[cfg(windows)]
async fn hand_over(app: &tauri::AppHandle, _kind: &str, path: &std::path::Path) -> Result<Handed, String> {
    std::process::Command::new(path)
        .spawn()
        .map_err(|e| format!("Could not start the installer: {e}"))?;
    // Closed a moment later, so the page can say why first; the setup then
    // finds no Kinema Media running and replaces it, keeping the library.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        app.exit(0);
    });
    Ok(Handed { state: "closing" })
}

#[cfg(target_os = "linux")]
async fn hand_over(_app: &tauri::AppHandle, kind: &str, path: &std::path::Path) -> Result<Handed, String> {
    let tool = if kind == "deb" { "apt-get" } else { "dnf" };
    let path = path.to_owned();
    let out = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("pkexec")
            .arg(tool)
            .args(["install", "-y"])
            .arg(&path)
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Could not ask the system to install it: {e}"))?;
    if out.status.success() {
        crate::log!("updates: {tool} installed the update");
        return Ok(Handed { state: "installed" });
    }
    let tail = String::from_utf8_lossy(&out.stderr);
    let tail: String = tail.lines().rev().take(3).collect::<Vec<_>>().join(" / ");
    crate::log!("updates: pkexec {tool} ended with {}: {tail}", out.status);
    // pkexec: 126 = the password was not given, 127 = no one to ask for it.
    Err(match out.status.code() {
        Some(126) => "Not installed: the password was not given.".into(),
        Some(127) => "The system could not ask for the password; use the download page.".into(),
        _ => format!("The system's installer did not install it ({tail}). Use the download page."),
    })
}

#[cfg(target_os = "android")]
async fn hand_over(_app: &tauri::AppHandle, _kind: &str, path: &std::path::Path) -> Result<Handed, String> {
    #[derive(Deserialize)]
    struct Answer {
        state: String,
    }
    let plugin = PLUGIN.get().ok_or("The installer is not ready.")?;
    let answer: Answer = plugin
        .run_mobile_plugin("installApk", serde_json::json!({ "path": path.to_string_lossy() }))
        .map_err(|e| format!("Android's installer did not open: {e}"))?;
    Ok(Handed { state: if answer.state == "permission" { "permission" } else { "opened" } })
}

#[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
async fn hand_over(_app: &tauri::AppHandle, _kind: &str, _path: &std::path::Path) -> Result<Handed, String> {
    Err("This system cannot update Kinema Media itself.".into())
}

/// Starts the newly installed Kinema Media (Linux, after "installed").
#[tauri::command]
pub fn restart_after_update(app: tauri::AppHandle) {
    crate::log!("updates: restarting into the new version");
    #[cfg(desktop)]
    tauri_plugin_single_instance::destroy(&app);
    app.restart();
}

#[cfg(target_os = "android")]
static PLUGIN: std::sync::OnceLock<tauri::plugin::PluginHandle<tauri::Wry>> = std::sync::OnceLock::new();

/// The Android half (UpdatePlugin.kt), called from Rust alone. Nothing on a
/// computer.
pub fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    #[cfg(desktop)]
    return builder;
    #[cfg(mobile)]
    builder.plugin(
        tauri::plugin::Builder::<tauri::Wry>::new("update")
            .setup(|_app, api| {
                #[cfg(target_os = "android")]
                {
                    let handle = api.register_android_plugin("com.kinema.app", "UpdatePlugin")?;
                    let _ = PLUGIN.set(handle);
                }
                #[cfg(not(target_os = "android"))]
                let _ = api;
                Ok(())
            })
            .build(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_as_numbers() {
        assert!(is_newer("0.3.1", "v0.3.2"));
        assert!(is_newer("0.3.9", "0.3.10"));
        assert!(is_newer("0.3.1", "1.0.0"));
        assert!(!is_newer("0.3.1", "v0.3.1"));
        assert!(!is_newer("0.3.2", "v0.3.1"));
    }

    #[test]
    fn a_tag_it_cannot_read_is_not_an_update() {
        assert!(!is_newer("0.3.1", "nightly"));
        assert!(!is_newer("0.3.1", ""));
    }

    #[test]
    fn a_pre_release_label_does_not_make_it_newer() {
        assert!(!is_newer("0.3.1", "0.3.1-beta"));
        assert!(is_newer("0.3.1", "0.4.0-rc1"));
    }

    #[test]
    fn a_test_release_must_be_on_this_machine() {
        assert!(is_loopback("http://127.0.0.1:8765/latest"));
        assert!(is_loopback("http://localhost/latest"));
        assert!(is_loopback("http://[::1]:9/x"));
        assert!(!is_loopback("http://127.0.0.1.example.com/latest"));
        assert!(!is_loopback("https://example.com/127.0.0.1"));
        assert!(!is_loopback("file:///tmp/latest"));
    }

    #[test]
    fn downloads_only_from_github_unless_testing() {
        let gh = "https://github.com/sawamura76/kinema-media/releases/download/v1.0.0/kinema-media-android.apk";
        assert!(allowed_download(gh, false));
        assert!(!allowed_download("http://github.com/x", false));
        assert!(!allowed_download("https://github.com.evil.example/x", false));
        assert!(!allowed_download("http://127.0.0.1:8765/x", false));
        assert!(allowed_download("http://127.0.0.1:8765/x", true));
    }

    #[test]
    fn reads_a_sha256sum_line() {
        let h = "a".repeat(64);
        assert_eq!(expected_sum(&format!("{h}  kinema-media-android.apk\n")).as_deref(), Some(h.as_str()));
        assert_eq!(expected_sum(&"A".repeat(64)).as_deref(), Some(h.as_str()));
        assert_eq!(expected_sum("not a hash"), None);
        assert_eq!(expected_sum(""), None);
    }

    #[test]
    fn needs_both_the_file_and_its_checksum() {
        let asset = |n: &str| Asset {
            name: n.into(),
            browser_download_url: format!("https://github.com/sawamura76/kinema-media/releases/download/v9.0.0/{n}"),
        };
        let mut r = GithubRelease {
            tag_name: "v9.0.0".into(),
            html_url: String::new(),
            draft: false,
            prerelease: false,
            assets: vec![asset("kinema-media-android.apk")],
        };
        assert!(files_for(&r, "apk", false).is_none());
        r.assets.push(asset("kinema-media-android.apk.sha256"));
        assert!(files_for(&r, "apk", false).is_some());
        assert!(files_for(&r, "setup", false).is_none());
    }
}
