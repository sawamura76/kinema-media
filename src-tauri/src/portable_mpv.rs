//! Resolve and pin portable playback DLLs before the plugin's lazy first playback load.
#![cfg(target_os = "windows")]
use libloading::os::windows::{LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR};
use libloading::Library;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
static LIBRARIES: OnceLock<Result<Vec<Library>, String>> = OnceLock::new();
fn directory(root: &Path) -> Result<PathBuf, String> {
    for folder in [root.to_path_buf(), root.join("lib")] {
        if folder.join("libmpv-2.dll").is_file() && folder.join("libmpv-wrapper.dll").is_file() {
            return Ok(folder);
        }
    }
    Err(format!("Playback DLLs were not found beside this copy of Kinema: {}. Extract the complete Windows ZIP and keep libmpv-2.dll and libmpv-wrapper.dll with the EXE.",root.display()))
}
fn load(folder: &Path) -> Result<Vec<Library>, String> {
    let mut libraries = Vec::new();
    for (name, exports) in [
        (
            "libmpv-2.dll",
            &[b"mpv_create\0".as_slice(), b"mpv_initialize\0".as_slice()][..],
        ),
        (
            "libmpv-wrapper.dll",
            &[
                b"mpv_wrapper_create\0".as_slice(),
                b"mpv_wrapper_destroy\0".as_slice(),
                b"mpv_wrapper_command\0".as_slice(),
                b"mpv_wrapper_set_property\0".as_slice(),
                b"mpv_wrapper_get_property\0".as_slice(),
                b"mpv_wrapper_free\0".as_slice(),
            ][..],
        ),
    ] {
        let path = folder.join(name);
        // SAFETY: these are the user-installed app's playback libraries. Search dependencies
        // in their own directory and Windows' normal safe directories, never an arbitrary CWD.
        let native = unsafe {
            libloading::os::windows::Library::load_with_flags(
                &path,
                LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
            )
        }
        .map_err(|error| format!("Could not load {}: {error}", path.display()))?;
        let library: Library = native.into();
        for symbol in exports {
            // Only inspect export addresses; no incorrectly typed function is invoked here.
            unsafe { library.get::<unsafe extern "C" fn()>(symbol) }.map_err(|error| {
                format!(
                    "Playback library {} is incompatible: {error}",
                    path.display()
                )
            })?;
        }
        libraries.push(library);
    }
    Ok(libraries)
}
pub fn prepare() -> Result<(), String> {
    LIBRARIES
        .get_or_init(|| {
            let exe = std::env::current_exe()
                .map_err(|error| format!("Cannot locate Kinema's executable: {error}"))?;
            let root = exe
                .parent()
                .ok_or("Cannot locate Kinema's application folder.")?;
            let folder = directory(root)?;
            let libraries = load(&folder)?;
            crate::log!(
                "playback: portable MPV libraries loaded from {}",
                folder.display()
            );
            Ok(libraries)
        })
        .as_ref()
        .map(|_| ())
        .map_err(Clone::clone)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_discovery_requires_both_dlls_and_supports_lib_subfolder() {
        let root = std::env::temp_dir().join(format!("kinema-mpv-pair-{}", std::process::id()));
        std::fs::create_dir_all(root.join("lib")).unwrap();
        assert!(directory(&root).is_err());
        std::fs::write(root.join("libmpv-wrapper.dll"), b"fixture").unwrap();
        assert!(directory(&root).is_err());
        for name in ["libmpv-2.dll", "libmpv-wrapper.dll"] {
            std::fs::write(root.join("lib").join(name), b"fixture").unwrap();
        }
        assert_eq!(directory(&root).unwrap(), root.join("lib"));
        std::fs::write(root.join("libmpv-2.dll"), b"fixture").unwrap();
        assert_eq!(directory(&root).unwrap(), root);
        for name in ["libmpv-2.dll", "libmpv-wrapper.dll"] {
            std::fs::remove_file(root.join(name)).unwrap();
            std::fs::remove_file(root.join("lib").join(name)).unwrap();
        }
        std::fs::remove_dir(root.join("lib")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[test]
    #[ignore = "Explicit native MPV smoke test with KINEMA_MPV_TEST_DIR; creates an audio/video-null player"]
    fn real_wrapper_initializes_with_a_different_working_directory() {
        use std::ffi::{c_char, c_void, CString};
        let folder = PathBuf::from(std::env::var("KINEMA_MPV_TEST_DIR").unwrap());
        assert_ne!(std::env::current_dir().unwrap(), folder);
        let libraries = load(&folder).unwrap();
        type Callback = unsafe extern "C" fn(*const c_char, *mut c_void);
        type Create = unsafe extern "C" fn(
            *const c_char,
            *const c_char,
            Option<Callback>,
            *mut c_void,
        ) -> *mut c_void;
        type Destroy = unsafe extern "C" fn(*mut c_void);
        unsafe extern "C" fn event(_: *const c_char, _: *mut c_void) {}
        let options = CString::new(
            r#"{"vo":"null","ao":"null","idle":"yes","terminal":"no","msg-level":"all=no"}"#,
        )
        .unwrap();
        let observed = CString::new("{}").unwrap();
        // SAFETY: signatures are the wrapper's exported C API; library handles outlive player.
        unsafe {
            let create = libraries[1].get::<Create>(b"mpv_wrapper_create\0").unwrap();
            let destroy = libraries[1]
                .get::<Destroy>(b"mpv_wrapper_destroy\0")
                .unwrap();
            let player = create(
                options.as_ptr(),
                observed.as_ptr(),
                Some(event),
                std::ptr::null_mut(),
            );
            assert!(
                !player.is_null(),
                "The bundled MPV wrapper could not initialize"
            );
            destroy(player);
        }
    }
}

