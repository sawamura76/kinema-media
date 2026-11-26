//! Real PCM snapshots for Butterchurn. Windows process loopback is restricted
//! to this Kinema process tree; no microphone, other apps, disk or network.
use serde::Serialize;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
const SAMPLES: usize = 1024;
struct Capture {
    left: [u8; SAMPLES],
    right: [u8; SAMPLES],
    cursor: usize,
    running: bool,
    ready: bool,
    error: Option<String>,
    requested: Instant,
    sampled: Instant,
}
impl Capture {
    fn new() -> Self {
        Self {
            left: [128; SAMPLES],
            right: [128; SAMPLES],
            cursor: 0,
            running: false,
            ready: false,
            error: None,
            requested: Instant::now(),
            sampled: Instant::now(),
        }
    }
    fn push(&mut self, left: i16, right: i16) {
        self.left[self.cursor] = ((left as i32 + 32768) >> 8) as u8;
        self.right[self.cursor] = ((right as i32 + 32768) >> 8) as u8;
        self.cursor = (self.cursor + 1) % SAMPLES;
    }
}
#[derive(Serialize)]
pub struct PcmFrame {
    left: Vec<u8>,
    right: Vec<u8>,
    ready: bool,
    error: Option<String>,
}
static CAPTURE: OnceLock<Arc<Mutex<Capture>>> = OnceLock::new();

#[tauri::command]
pub fn music_visualizer_frame(reset: bool) -> Result<PcmFrame, String> {
    let shared = CAPTURE
        .get_or_init(|| Arc::new(Mutex::new(Capture::new())))
        .clone();
    let mut state = shared.lock().map_err(|e| e.to_string())?;
    state.requested = Instant::now();
    if reset {
        state.error = None;
    }
    if !state.running && state.error.is_none() {
        state.running = true;
        state.ready = false;
        state.left.fill(128);
        state.right.fill(128);
        let worker = shared.clone();
        std::thread::spawn(move || {
            let result = platform::run(&worker);
            if let Ok(mut state) = worker.lock() {
                state.running = false;
                if let Err(e) = result {
                    state.error = Some(format!("Kinema audio capture: {e}"));
                }
            }
        });
    }
    let fresh = state.sampled.elapsed() < Duration::from_millis(150);
    let left = (0..SAMPLES)
        .map(|n| {
            if fresh {
                state.left[(state.cursor + n) % SAMPLES]
            } else {
                128
            }
        })
        .collect();
    let right = (0..SAMPLES)
        .map(|n| {
            if fresh {
                state.right[(state.cursor + n) % SAMPLES]
            } else {
                128
            }
        })
        .collect();
    Ok(PcmFrame {
        left,
        right,
        ready: state.ready,
        error: state.error.clone(),
    })
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn run(_: &Arc<Mutex<Capture>>) -> Result<(), String> {
        Err("Butterchurn audio input currently requires Windows 11.".into())
    }
}
#[cfg(windows)]
mod platform {
    use super::*;
    use windows::core::{implement, Interface, Ref, Result as WinResult, HRESULT};
    use windows::Win32::{
        Foundation::{CloseHandle, HANDLE},
        Media::Audio::*,
        System::{
            Com::StructuredStorage::*,
            Com::*,
            Threading::{CreateEventW, WaitForSingleObject},
            Variant::VT_BLOB,
        },
    };
    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct Activated {
        notify: std::sync::mpsc::Sender<()>,
    }
    impl IActivateAudioInterfaceCompletionHandler_Impl for Activated_Impl {
        fn ActivateCompleted(
            &self,
            _: Ref<'_, IActivateAudioInterfaceAsyncOperation>,
        ) -> WinResult<()> {
            let _ = self.notify.send(());
            Ok(())
        }
    }
    struct Signal(HANDLE);
    impl Drop for Signal {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
    #[link(name = "mfplat")]
    unsafe extern "system" {
        fn MFStartup(version: u32, flags: u32) -> HRESULT;
        fn MFShutdown() -> HRESULT;
    }
    struct MediaFoundation;
    impl Drop for MediaFoundation {
        fn drop(&mut self) {
            unsafe {
                let _ = MFShutdown();
            }
        }
    }
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    pub fn run(shared: &Arc<Mutex<Capture>>) -> Result<(), String> {
        // COM interfaces and sample buffers stay on this single MTA thread.
        unsafe { capture(shared).map_err(|e| e.to_string()) }
    }
    unsafe fn capture(shared: &Arc<Mutex<Capture>>) -> WinResult<()> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
            let _apartment = Apartment;
            MFStartup(0x00020070, 1).ok()?;
            let _media = MediaFoundation;
            let mut activation = AUDIOCLIENT_ACTIVATION_PARAMS {
                ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
                Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                    ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                        TargetProcessId: std::process::id(),
                        ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
                    },
                },
            };
            // Borrowed stack blob: PROPVARIANT's extension Drop would free it.
            // Keep the outer variant non-owning as well as the inner union.
            let params = std::mem::ManuallyDrop::new(PROPVARIANT {
                Anonymous: PROPVARIANT_0 {
                    Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                        vt: VT_BLOB,
                        Anonymous: PROPVARIANT_0_0_0 {
                            blob: BLOB {
                                cbSize: std::mem::size_of_val(&activation) as u32,
                                pBlobData: (&mut activation as *mut AUDIOCLIENT_ACTIVATION_PARAMS)
                                    .cast(),
                            },
                        },
                        ..Default::default()
                    }),
                },
            });
            let (notify, ready) = std::sync::mpsc::channel();
            let callback: IActivateAudioInterfaceCompletionHandler = Activated { notify }.into();
            let operation = ActivateAudioInterfaceAsync(
                VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                &IAudioClient::IID,
                Some(&*params),
                &callback,
            )?;
            ready.recv_timeout(Duration::from_secs(5)).map_err(|_| {
                windows::core::Error::new(
                    HRESULT(0x800705B4u32 as i32),
                    "Audio capture activation timed out",
                )
            })?;
            let mut result = HRESULT(0);
            let mut unknown = None;
            operation.GetActivateResult(&mut result, &mut unknown)?;
            result.ok()?;
            let client: IAudioClient = unknown
                .ok_or_else(windows::core::Error::from_win32)?
                .cast()?;
            drop(operation);
            drop(callback);
            let format = WAVEFORMATEX {
                wFormatTag: 1,
                nChannels: 2,
                nSamplesPerSec: 44100,
                nAvgBytesPerSec: 176400,
                nBlockAlign: 4,
                wBitsPerSample: 16,
                cbSize: 0,
            };
            client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK
                    | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                    | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                0,
                0,
                &format,
                None,
            )?;
            let event = Signal(CreateEventW(None, false, false, None)?);
            client.SetEventHandle(event.0)?;
            let reader: IAudioCaptureClient = client.GetService()?;
            client.Start()?;
            if let Ok(mut state) = shared.lock() {
                state.ready = true;
            }
            let result = (|| -> WinResult<()> {
                'capture: loop {
                    if shared
                        .lock()
                        .map(|s| s.requested.elapsed() > Duration::from_secs(2))
                        .unwrap_or(true)
                    {
                        break;
                    }
                    while reader.GetNextPacketSize()? > 0 {
                        if shared
                            .lock()
                            .map(|s| s.requested.elapsed() > Duration::from_secs(2))
                            .unwrap_or(true)
                        {
                            break 'capture;
                        }
                        let mut data = std::ptr::null_mut();
                        let mut count = 0;
                        let mut flags = 0;
                        reader.GetBuffer(&mut data, &mut count, &mut flags, None, None)?;
                        if let Ok(mut state) = shared.lock() {
                            let silent =
                                flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null();
                            for frame in 0..count as usize {
                                // The format requested above is interleaved stereo s16.
                                let (l, r) = if silent {
                                    (0, 0)
                                } else {
                                    let sample = data.add(frame * 4).cast::<i16>();
                                    (sample.read_unaligned(), sample.add(1).read_unaligned())
                                };
                                state.push(l, r);
                            }
                            state.sampled = Instant::now();
                        }
                        reader.ReleaseBuffer(count)?;
                    }
                    let _ = WaitForSingleObject(event.0, 50);
                }
                Ok(())
            })();
            let _ = client.Stop();
            drop(reader);
            drop(client);
            drop(event);
            result
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pcm_conversion_and_ring_preserve_channel_order() {
        let mut c = Capture::new();
        c.push(i16::MIN, i16::MAX);
        c.push(0, 0);
        assert_eq!((c.left[0], c.right[0]), (0, 255));
        assert_eq!((c.left[1], c.right[1]), (128, 128));
        for _ in 0..SAMPLES {
            c.push(256, -256);
        }
        assert!(c.left.iter().all(|v| *v == 129));
        assert!(c.right.iter().all(|v| *v == 127));
    }
    #[test]
    #[ignore = "requires a Windows audio service; run explicitly"]
    fn windows_capture_starts_and_stops_without_polling() {
        music_visualizer_frame(true).unwrap();
        let mut ready = false;
        for _ in 0..70 {
            std::thread::sleep(Duration::from_millis(100));
            let frame = music_visualizer_frame(false).unwrap();
            assert!(frame.error.is_none(), "{:?}", frame.error);
            if frame.ready {
                ready = true;
                break;
            }
        }
        assert!(ready, "capture never became ready");
        for _ in 0..60 {
            std::thread::sleep(Duration::from_millis(100));
            if !CAPTURE.get().unwrap().lock().unwrap().running {
                return;
            }
        }
        panic!("capture worker did not stop after polling ceased");
    }
    #[test]
    #[ignore = "plays a brief quiet test tone; run explicitly on Windows"]
    fn windows_pcm_contains_the_apps_real_waveform() {
        #[cfg(windows)]
        {
            use windows::core::PCWSTR;
            use windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_FILENAME};
            let rate = 44100u32;
            let mut samples = Vec::new();
            for n in 0..rate * 2 {
                let value = (2000.0
                    * (n as f64 * 440.0 * std::f64::consts::TAU / rate as f64).sin())
                    as i16;
                samples.extend(value.to_le_bytes());
                samples.extend(value.to_le_bytes());
            }
            let mut wav = Vec::new();
            wav.extend(b"RIFF");
            wav.extend((samples.len() as u32 + 36).to_le_bytes());
            wav.extend(b"WAVEfmt ");
            wav.extend(16u32.to_le_bytes());
            wav.extend(1u16.to_le_bytes());
            wav.extend(2u16.to_le_bytes());
            wav.extend(rate.to_le_bytes());
            wav.extend((rate * 4).to_le_bytes());
            wav.extend(4u16.to_le_bytes());
            wav.extend(16u16.to_le_bytes());
            wav.extend(b"data");
            wav.extend((samples.len() as u32).to_le_bytes());
            wav.extend(samples);
            let path =
                std::env::temp_dir().join(format!("kinema-pcm-tone-{}.wav", std::process::id()));
            std::fs::write(&path, wav).unwrap();
            let wide: Vec<u16> = path
                .to_string_lossy()
                .encode_utf16()
                .chain(Some(0))
                .collect();
            music_visualizer_frame(true).unwrap();
            for _ in 0..60 {
                let frame = music_visualizer_frame(false).unwrap();
                assert!(frame.error.is_none(), "{:?}", frame.error);
                if frame.ready {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            assert!(
                unsafe { PlaySoundW(PCWSTR(wide.as_ptr()), None, SND_ASYNC | SND_FILENAME) }
                    .as_bool()
            );
            let mut heard = false;
            for _ in 0..15 {
                std::thread::sleep(Duration::from_millis(80));
                let frame = music_visualizer_frame(false).unwrap();
                if frame.left.iter().any(|v| v.abs_diff(128) >= 4) {
                    heard = true;
                    break;
                }
            }
            unsafe {
                let _ = PlaySoundW(PCWSTR::null(), None, Default::default());
            }
            assert!(
                heard,
                "process loopback did not capture the generated waveform"
            );
            for _ in 0..60 {
                std::thread::sleep(Duration::from_millis(100));
                if !CAPTURE.get().unwrap().lock().unwrap().running {
                    return;
                }
            }
            panic!("capture worker did not stop");
        }
    }
}
