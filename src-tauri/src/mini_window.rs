//! Reuse the playback window: mpv keeps its native video surface and audio.
//! A minimized active player becomes a small, resizable, topmost window.
//! Window calls must stay outside the state lock: worker calls dispatch to
//! the UI thread, whose window-event callbacks also inspect this state.
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Clone)]
struct Geometry { size: tauri::PhysicalSize<u32>, position: tauri::PhysicalPosition<i32> }
#[derive(Clone)]
struct Snapshot { geometry: Geometry, fullscreen: bool, maximized: bool, top: bool, decorated: bool, resizable: bool }
#[derive(Default)]
struct Inner { kind: Option<String>, floating: bool, busy: bool, saved: Option<Snapshot>, small: Option<Geometry> }
#[derive(Default)]
pub struct Floating(Mutex<Inner>);

pub fn watch(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let Some(webview) = app.get_webview_window("main") else { break };
        let window = webview.as_ref().window();
        let state = window.state::<Floating>();
        let eligible = state.0.lock().is_ok_and(|s| s.kind.is_some() && !s.floating && !s.busy);
        // Some Windows minimize paths send no Resized event; this also covers
        // playback starting while the window was already minimized.
        if eligible && window.is_minimized().unwrap_or(false) { enter(window); }
    });
}

fn snapshot(window: &tauri::Window) -> Result<Snapshot, String> {
    Ok(Snapshot {
        geometry: Geometry { size: window.inner_size().map_err(err)?, position: window.outer_position().map_err(err)? },
        fullscreen: window.is_fullscreen().map_err(err)?, maximized: window.is_maximized().map_err(err)?,
        top: window.is_always_on_top().map_err(err)?, decorated: window.is_decorated().map_err(err)?, resizable: window.is_resizable().map_err(err)?,
    })
}
fn err(e: tauri::Error) -> String { e.to_string() }
fn announce(window: &tauri::Window, value: bool) { let _ = window.emit("floating-player", value); }

fn restore(window: &tauri::Window) -> Result<(), String> {
    let state = window.state::<Floating>();
    let geometry = if !window.is_minimized().unwrap_or(false) {
        match (window.inner_size(), window.outer_position()) { (Ok(size), Ok(position)) => Some(Geometry { size, position }), _ => None }
    } else { None };
    let saved = {
        let mut s = state.0.lock().map_err(|e| e.to_string())?;
        if !s.floating || s.busy { return Ok(()); }
        s.busy = true;
        if let Some(geometry) = geometry { s.small = Some(geometry); }
        s.saved.clone()
    };
    let result = (|| {
        window.unminimize().map_err(err)?;
        window.set_fullscreen(false).map_err(err)?;
        window.unmaximize().map_err(err)?;
        window.set_min_size(Some(tauri::LogicalSize::new(854., 480.))).map_err(err)?;
        if let Some(saved) = saved {
            window.set_always_on_top(saved.top).map_err(err)?;
            window.set_decorations(saved.decorated).map_err(err)?;
            window.set_resizable(saved.resizable).map_err(err)?;
            window.set_size(saved.geometry.size).map_err(err)?;
            window.set_position(saved.geometry.position).map_err(err)?;
            if saved.maximized { window.maximize().map_err(err)?; }
            if saved.fullscreen { window.set_fullscreen(true).map_err(err)?; }
        } else { window.set_always_on_top(false).map_err(err)?; }
        window.set_title("Kinema Media").map_err(err)?;
        Ok(())
    })();
    {
        let mut s = state.0.lock().map_err(|e| e.to_string())?;
        s.busy = false; s.floating = false;
    }
    announce(window, false);
    result
}

fn enter(window: tauri::Window) {
    let state = window.state::<Floating>();
    let minimized = window.is_minimized().unwrap_or(false);
    let top = window.is_always_on_top().unwrap_or(false);
    let (kind, small) = {
        let Ok(mut s) = state.0.lock() else { return };
        if s.busy || s.floating || s.kind.is_none() || s.saved.is_none() || !minimized { return; }
        // Z-order changes need not send Moved/Resized, unlike the geometry.
        if let Some(saved) = s.saved.as_mut() { saved.top = top; }
        s.busy = true; s.floating = true;
        (s.kind.clone().unwrap_or_default(), s.small.clone())
    };
    announce(&window, true);
    let result: Result<(), String> = (|| {
        window.set_fullscreen(false).map_err(err)?;
        // Restoring an iconic maximized window *after* sizing would reapply
        // Windows' old maximized placement and undo the mini-player bounds.
        window.unminimize().map_err(err)?;
        window.unmaximize().map_err(err)?;
        window.set_min_size(Some(tauri::LogicalSize::new(320., 200.))).map_err(err)?;
        window.set_decorations(true).map_err(err)?;
        window.set_resizable(true).map_err(err)?;
        window.set_always_on_top(true).map_err(err)?;
        if let Some(small) = small {
            window.set_size(small.size).map_err(err)?;
            window.set_position(small.position).map_err(err)?;
        } else {
            let (width, height) = if kind == "video" { (560., 340.) } else { (460., 230.) };
            window.set_size(tauri::LogicalSize::new(width, height)).map_err(err)?;
            if let Some(monitor) = window.current_monitor().map_err(err)? {
                let area = monitor.work_area();
                let scale = monitor.scale_factor();
                let x = area.position.x as f64 + (area.size.width as f64 - (width + 20.) * scale).max(0.);
                let y = area.position.y as f64 + (area.size.height as f64 - (height + 60.) * scale).max(0.);
                window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32)).map_err(err)?;
            }
        }
        window.set_title("Kinema Media — Mini-player").map_err(err)?;
        window.show().map_err(err)?;
        Ok(())
    })();
    let disabled = {
        let Ok(mut s) = state.0.lock() else { return };
        s.busy = false; s.kind.is_none()
    };
    if result.is_err() || disabled {
        if let Err(e) = result { crate::log!("mini-player: {e}"); }
        if let Err(e) = restore(&window) { crate::log!("mini-player restore: {e}"); }
    }
}

pub fn on_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" || !matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Focused(_)) { return; }
    let Some(state) = window.try_state::<Floating>() else { return };
    let minimized = window.is_minimized().unwrap_or(false);
    let saved = if minimized { None } else { snapshot(window).ok() };
    let Ok(mut s) = state.0.try_lock() else { return };
    if s.busy || s.floating { return; }
    if minimized {
        if s.kind.is_some() {
            let window = window.clone();
            // Never wait for native window changes from inside its event handler.
            std::thread::spawn(move || enter(window));
        }
    } else if let Some(saved) = saved { s.saved = Some(saved); }
}

#[tauri::command]
pub async fn mini_player_sync(window: tauri::Window, kind: Option<String>) -> Result<bool, String> {
    if window.label() != "main" { return Err("Only the main player owns the mini-player".into()); }
    if kind.as_deref().is_some_and(|v| v != "music" && v != "video") { return Err("Unknown media type".into()); }
    let state = window.state::<Floating>();
    let saved = if window.is_minimized().unwrap_or(false) { None } else { snapshot(&window).ok() };
    let should_restore = {
        let mut s = state.0.lock().map_err(|e| e.to_string())?;
        s.kind = kind;
        if !s.floating && !s.busy { if let Some(saved) = saved { s.saved = Some(saved); } }
        s.kind.is_none() && s.floating && !s.busy
    };
    if should_restore { restore(&window)?; }
    let floating = state.0.lock().map_err(|e| e.to_string())?.floating;
    Ok(floating)
}

#[tauri::command]
pub async fn mini_player_restore(window: tauri::Window) -> Result<(), String> { restore(&window) }
