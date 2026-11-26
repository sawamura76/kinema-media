//! The page that lets YouTube's trailer play inside Skrin on Linux.
//!
//! YouTube's embedded player plays only for a page with a web address it can
//! read as a Referer. Skrin's own page on Linux comes from a scheme of its own
//! (`tauri://localhost`), so the embed answered "Error 153". This serves one
//! small page on this computer only — `127.0.0.1`, an address no other machine
//! can reach — that holds nothing but YouTube's official embed, and the trailer
//! overlay shows that page in its frame. The page passes the overlay's
//! messages to the player and the player's news back; it loads none of
//! YouTube's script, and nothing new leaves the computer: the same YouTube
//! host is asked, only for a different page address.
//!
//! Started on the first trailer, never otherwise; one fixed page, no files.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::OnceLock;
use std::time::Duration;

/// The page: a frame for YouTube's embed (the id is checked before it is used)
/// and a relay of messages between it and the overlay around it.
const PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>Trailer</title>
<style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#000;overflow:hidden}</style>
<iframe id="y" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>
<script>
const Y = 'https://www.youtube-nocookie.com';
const y = document.getElementById('y');
const key = new URLSearchParams(location.search).get('k') || '';
if (/^[A-Za-z0-9_-]{6,20}$/.test(key)) {
  const o = encodeURIComponent(location.origin);
  y.src = Y + '/embed/' + key + '?enablejsapi=1&autoplay=1&playsinline=1&rel=0&origin=' + o + '&widget_referrer=' + o;
}
addEventListener('message', (e) => {
  if (e.source === parent && typeof e.data === 'string') y.contentWindow.postMessage(e.data, Y);
  else if (e.source === y.contentWindow && e.origin === Y) parent.postMessage(e.data, '*');
});
</script>"#;

static PORT: OnceLock<u16> = OnceLock::new();

fn port() -> std::io::Result<u16> {
    if let Some(p) = PORT.get() {
        return Ok(*p);
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    if *PORT.get_or_init(|| port) == port {
        std::thread::spawn(move || {
            for conn in listener.incoming().flatten() {
                std::thread::spawn(move || {
                    if let Err(e) = answer(conn) {
                        log::debug!("trailer page: {e}");
                    }
                });
            }
        });
    }
    Ok(*PORT.get().unwrap_or(&port))
}

/// Read the request line and headers, then send the page whatever was asked.
fn answer(mut conn: TcpStream) -> std::io::Result<()> {
    conn.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut buf = [0u8; 2048];
    let mut seen = Vec::new();
    while !seen.windows(4).any(|w| w == b"\r\n\r\n") && seen.len() < 16 * 1024 {
        let n = conn.read(&mut buf)?;
        if n == 0 {
            break;
        }
        seen.extend_from_slice(&buf[..n]);
    }
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        PAGE.len()
    );
    conn.write_all(head.as_bytes())?;
    if !seen.starts_with(b"HEAD ") {
        conn.write_all(PAGE.as_bytes())?;
    }
    conn.flush()
}

/// The address of the page, starting it if it is not running.
#[tauri::command]
pub async fn trailer_page_address() -> Result<String, String> {
    crate::net::allowed(crate::net::Service::Youtube)?;
    port()
        .map(|p| format!("http://127.0.0.1:{p}/"))
        .map_err(|e| format!("could not start the trailer page: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_the_page_on_loopback_only() {
        let p = port().unwrap();
        let mut c = TcpStream::connect(("127.0.0.1", p)).unwrap();
        c.write_all(b"GET /?k=M7lc1UVf-VE HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        let mut got = String::new();
        c.read_to_string(&mut got).unwrap();
        assert!(got.starts_with("HTTP/1.1 200"));
        assert!(got.contains("youtube-nocookie.com"));
        // A second call gives the same port: one listener per run.
        assert_eq!(port().unwrap(), p);
    }
}
