//! The title at the top of Home, named by hand — for screenshots.
//!
//! Home's top title is the day's pick (`src/ui/hero.ts`), which can take months
//! to reach a given film in a big library. For the README and website pictures
//! the owner writes a film's name in `home-top.txt` in the data folder, and Home
//! shows that one instead. No setting and nothing on screen: delete the file and
//! the day's pick is back. A name that matches no title is ignored by the page.
//! docs/images/README.md says how to use it.

use std::path::Path;

/// In the data folder, beside `library.db`.
pub const FILE: &str = "home-top.txt";

/// The first line of the file that has anything on it, trimmed; `None` when
/// there is no file or nothing in it. A byte-order mark (some editors write
/// one) is not part of the name.
fn read(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    text.trim_start_matches('\u{feff}')
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_string)
}

/// The name in `home-top.txt`, if the owner put one there.
#[tauri::command]
pub fn home_top(app: tauri::AppHandle) -> Option<String> {
    read(&crate::data_dir(&app).ok()?.join(FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(name: &str, text: &str) -> Option<String> {
        let dir = std::env::temp_dir().join(format!("skrin-home-top-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        std::fs::write(&path, text).unwrap();
        let got = read(&path);
        let _ = std::fs::remove_dir_all(&dir);
        got
    }

    #[test]
    fn the_first_line_with_a_name_trimmed() {
        assert_eq!(
            with("lines", "\r\n  A Film (2024)  \r\nanother\r\n").as_deref(),
            Some("A Film (2024)")
        );
    }

    #[test]
    fn a_byte_order_mark_is_not_part_of_the_name() {
        assert_eq!(with("bom", "\u{feff}A Film").as_deref(), Some("A Film"));
    }

    #[test]
    fn no_file_or_an_empty_one_is_no_choice() {
        assert_eq!(with("empty", "  \n\n"), None);
        assert_eq!(read(Path::new("does-not-exist/home-top.txt")), None);
    }
}
