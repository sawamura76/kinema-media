//! The country the system itself says it is in — what the age rating on the
//! details page follows. Asked of the system, never guessed: Windows' region
//! setting, the territory of Linux's locale variables, and nothing on Android
//! (the page falls back to the webview's locale there, which Android always
//! gives a country). `None` means the system names no country.

/// A two-letter country code, upper case, or None. Windows can answer with a
/// UN M.49 number for a whole area ("150"); that is no country.
#[cfg_attr(not(any(test, windows, target_os = "linux")), allow(dead_code))]
fn country_code(s: &str) -> Option<String> {
    let s = s.trim();
    (s.len() == 2 && s.bytes().all(|b| b.is_ascii_alphabetic())).then(|| s.to_ascii_uppercase())
}

/// The territory of a POSIX locale name: `nb_NO.UTF-8` → NO, `de_AT@euro` →
/// AT. `C`, `POSIX` and a bare language (`en`) name none.
#[cfg_attr(not(any(test, target_os = "linux")), allow(dead_code))]
fn territory(locale: &str) -> Option<String> {
    let name = locale.split(['.', '@']).next()?;
    country_code(name.split_once('_')?.1)
}

/// Linux: the first of LC_ALL, LC_MESSAGES, LANG that is set (empty counts as
/// unset, as the C library treats it) decides, as it does for the system's own
/// programs; its territory is the country, or none.
#[cfg_attr(not(any(test, target_os = "linux")), allow(dead_code))]
fn from_env(get: impl Fn(&str) -> Option<String>) -> Option<String> {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .find_map(|k| get(k).filter(|v| !v.is_empty()))
        .and_then(|v| territory(&v))
}

#[cfg(windows)]
fn system_region_now() -> Option<String> {
    let mut buf = [0u16; 16];
    // SAFETY: the buffer is ours and its length is passed with it.
    let n = unsafe { windows::Win32::Globalization::GetUserDefaultGeoName(&mut buf) };
    if n <= 1 {
        return None;
    }
    country_code(&String::from_utf16_lossy(&buf[..(n as usize - 1).min(buf.len())]))
}

#[cfg(target_os = "linux")]
fn system_region_now() -> Option<String> {
    from_env(|k| std::env::var(k).ok())
}

#[cfg(not(any(windows, target_os = "linux")))]
fn system_region_now() -> Option<String> {
    None
}

/// The system's country code (`NO`, `US`), or None when it names none.
#[tauri::command]
pub fn system_region() -> Option<String> {
    system_region_now()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_country_is_two_letters() {
        assert_eq!(country_code("no"), Some("NO".into()));
        assert_eq!(country_code("NO\n"), Some("NO".into()));
        // an area, not a country
        assert_eq!(country_code("150"), None);
        assert_eq!(country_code(""), None);
        assert_eq!(country_code("USA"), None);
    }

    #[test]
    fn a_locale_names_its_territory() {
        assert_eq!(territory("nb_NO.UTF-8"), Some("NO".into()));
        assert_eq!(territory("de_AT@euro"), Some("AT".into()));
        assert_eq!(territory("en_GB"), Some("GB".into()));
        assert_eq!(territory("C"), None);
        assert_eq!(territory("POSIX"), None);
        assert_eq!(territory("en"), None);
        assert_eq!(territory("C.UTF-8"), None);
        assert_eq!(territory(""), None);
    }

    #[test]
    fn linux_asks_the_variables_in_the_systems_order() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |k: &str| {
                pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string())
            }
        };
        assert_eq!(from_env(env(&[("LANG", "nb_NO.UTF-8")])), Some("NO".into()));
        // LC_ALL wins over LANG
        assert_eq!(
            from_env(env(&[("LC_ALL", "sv_SE.UTF-8"), ("LANG", "nb_NO.UTF-8")])),
            Some("SE".into())
        );
        assert_eq!(
            from_env(env(&[("LC_MESSAGES", "da_DK.UTF-8"), ("LANG", "nb_NO.UTF-8")])),
            Some("DK".into())
        );
        // empty is unset
        assert_eq!(
            from_env(env(&[("LC_ALL", ""), ("LANG", "nb_NO.UTF-8")])),
            Some("NO".into())
        );
        // the winning variable names no country: none, not the next one's
        assert_eq!(from_env(env(&[("LC_ALL", "C"), ("LANG", "nb_NO.UTF-8")])), None);
        assert_eq!(from_env(env(&[])), None);
    }
}
