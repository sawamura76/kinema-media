//! Automatic subtitle timing (round 10, notes/SUBTITLE-TIMING.md, option A):
//! "Fix timing automatically" in the subtitle panel, and the quiet check after
//! an OpenSubtitles download.
//!
//! A subtitle file made for another release comes early or late by the same
//! amount all through, and one made for a 25 fps release of a 23.976 fps film
//! also drifts — later and later towards the end. Both are found here by
//! comparing *when the chosen subtitle shows its lines* with *when people
//! speak* (or, where the film has a text subtitle built in, *when that one
//! shows its lines*) in [`WINDOWS`] short stretches spread over the film:
//!
//! 1. The stretches are read by a second libmpv handle, as seek previews and a
//!    Videos tile's frame are (`seek_preview.rs`, `videos.rs`): raw sound
//!    through `ao=pcm` (no ffmpeg), or a built-in subtitle's cue times, which
//!    need the video decoded — subtitles advance with video frames (GOTCHAS).
//! 2. Speech is found by plain signal reading ([`speech`]): energy in the
//!    voice band against the stretch's own noise floor. No learned model.
//! 3. For each speed a subtitle can be made for ([`SPEEDS`] — never free-form)
//!    each stretch votes for the offset that lines the two up best ([`vote`]).
//! 4. Only when most stretches agree is anything moved ([`fit`]); split votes
//!    say "made for another version", no agreement says "could not tell".
//!
//! The result is applied by mpv's own `sub-delay` and `sub-speed` (the page,
//! `subDelay.ts`) — the subtitle file is never changed. Nothing leaves the
//! computer. Android has no mpv: the button is not offered there (PLAN.md,
//! "Desktop features Android must get").
//!
//! The alignment below is free of any platform and waits for Android's own
//! reader; until then Android's build has only the command, which refuses.
#![cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]

use serde::Serialize;

/// The time step of every on/off signal: 10 ms.
pub const RES: f64 = 0.01;
/// The coarse search step, in fine steps: 100 ms.
const COARSE: usize = 10;
/// How far a subtitle can be off and still be found.
pub const MAX_SHIFT: f64 = 90.0;
/// One stretch's length, and how many are read.
pub const WINDOW_SECS: f64 = 40.0;
pub const WINDOWS: usize = 8;
/// Stretches agree when their offsets are this close.
pub const AGREE_WITHIN: f64 = 0.3;
/// A stretch votes only when its best offset beats the next best (more than a
/// second away) by this much; otherwise it abstains.
pub const MIN_SHARPNESS: f64 = 1.1;
/// A line's start counts towards a speech onset this close (the fine step).
const ONSET_REACH: f64 = 0.3;
/// Lines are made to show a beat before the words, and speech is found a
/// little after it starts; the fine step lines starts up with speech, so this
/// much is given back (0.1–0.4 s on made-up and real films).
const LEAD: f64 = 0.2;
/// At least this many stretches must agree, and this share of those that
/// voted, and more than half of all read — and the rest must not agree among
/// themselves on another offset (that is a subtitle for another cut). Five
/// stretches landing within [`AGREE_WITHIN`] of one another by chance, in a
/// ±90 s search, does not happen; votes that scatter are stretches that could
/// not hear well, and are outvoted.
pub const MIN_AGREE: usize = 4;
pub const AGREE_SHARE: f64 = 0.6;
/// Closer than this, with no speed change, is "already in time". Lines are
/// made to show a beat before the words, by more or less: on a real film the
/// file's own subtitle measured 0.3 s from where [`LEAD`] puts it, every
/// stretch alike. Less than that is not worth a change.
pub const IN_TIME: f64 = 0.3;
/// Speech: a frame's voice-band energy this far above the average of the
/// frames around it (half a second).
const RISE_DB: f64 = 3.0;
const AVERAGE_FRAMES: usize = 50;
/// Shorter files are not checked: too few stretches to agree.
pub const MIN_DURATION: f64 = 6.0 * 60.0;
/// Fewer lines than this in the file is nothing to time.
pub const MIN_CUES: usize = 20;

/// The speeds tried, as (frame rate the subtitle was made for, the film's):
/// a subtitle made for a 25 fps (PAL) release runs fast on a 23.976 film.
/// The first is "the same speed".
pub const SPEEDS: [(f64, f64); 7] = [
    (1.0, 1.0),
    (25.0, 23.976),
    (23.976, 25.0),
    (24.0, 23.976),
    (23.976, 24.0),
    (25.0, 24.0),
    (24.0, 25.0),
];

/// mpv's `sub-speed` for a pair: film time = cue time × speed + delay.
pub fn speed_of(pair: (f64, f64)) -> f64 {
    pair.0 / pair.1
}

/// One stretch: where it starts in the film, and the reference — speech, or
/// a built-in subtitle's lines — on or off every [`RES`].
#[derive(Debug, Clone)]
pub struct Window {
    pub start: f64,
    pub on: Vec<bool>,
    /// How much a line shows ahead of this reference: [`LEAD`] for speech,
    /// 0 for a subtitle built into the film (timed like the lines).
    pub lead: f64,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// Most stretches agree on a change: offered or applied.
    Fixed,
    /// Most stretches agree it is already right.
    InTime,
    /// Two groups agree on two different offsets: a subtitle for another cut.
    OtherCut,
    /// No agreement: nothing moves.
    Unsure,
    /// The film is too short to check.
    TooShort,
    /// The subtitle file has too few lines Skrin can read the times of.
    NoLines,
}

/// What a check found, for the page to say and apply.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Finding {
    pub outcome: Outcome,
    /// mpv's `sub-delay`, seconds (positive: later).
    pub delay_secs: f64,
    /// mpv's `sub-speed`; 1 when the speed is right.
    pub speed: f64,
    /// The frame rates behind `speed`, for the words ("made for 25 fps").
    pub from_fps: f64,
    pub to_fps: f64,
    /// Stretches that agree, that voted, and that were read.
    pub agree: usize,
    pub usable: usize,
    pub checks: usize,
    /// What the subtitle was compared with: "speech", "subtitles" or "both".
    pub reference: String,
    pub millis: u64,
}

impl Finding {
    fn plain(outcome: Outcome, checks: usize) -> Self {
        Self {
            outcome,
            delay_secs: 0.0,
            speed: 1.0,
            from_fps: 1.0,
            to_fps: 1.0,
            agree: 0,
            usable: 0,
            checks,
            reference: String::new(),
            millis: 0,
        }
    }
}

/// The cues, moved by a speed: film times.
fn mapped(cues: &[(f64, f64)], speed: f64) -> Vec<(f64, f64)> {
    let mut out: Vec<(f64, f64)> = cues.iter().map(|&(a, b)| (a * speed, b * speed)).collect();
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    out
}

/// Whether any cue shows at `t` (cues sorted by start, as [`mapped`] gives).
fn showing(cues: &[(f64, f64)], t: f64) -> bool {
    let after = cues.partition_point(|c| c.0 <= t);
    // Cues are short; look back over the few that started before `t`.
    cues[..after].iter().rev().take(8).any(|c| c.1 > t)
}

#[allow(clippy::cast_precision_loss)]
fn as_f64(n: usize) -> f64 {
    n as f64
}

/// One stretch's vote at one speed: the delay that lines the subtitle up with
/// the reference best, and how clearly it beats any other (a second away or
/// more). None when the stretch has too little of either to say.
pub fn vote(cues: &[(f64, f64)], w: &Window, speed: f64) -> Option<(f64, f64)> {
    let n = w.on.len();
    if n < 10 * COARSE {
        return None;
    }
    let share = as_f64(w.on.iter().filter(|&&b| b).count()) / as_f64(n);
    if !(0.05..=0.9).contains(&share) {
        return None;
    }
    let cues = mapped(cues, speed);
    // Coarse: 100 ms bins, the reference centred so that a subtitle showing
    // all the time scores nothing.
    let bins = n / COARSE;
    let r: Vec<f64> = (0..bins)
        .map(|i| as_f64(w.on[i * COARSE..(i + 1) * COARSE].iter().filter(|&&b| b).count()) / as_f64(COARSE) - share)
        .collect();
    let step = RES * as_f64(COARSE);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let half = (MAX_SHIFT / step).round() as usize;
    // Each line adds the reference over the bins it covers (a bin counts when
    // its middle is inside the line): a running sum makes that one subtraction.
    let mut sum = vec![0.0; bins + 1];
    for i in 0..bins {
        sum[i + 1] = sum[i] + r[i];
    }
    let end = w.start + as_f64(bins) * step;
    // Lines that overlap count once: merged.
    let mut near: Vec<(f64, f64)> = Vec::new();
    for &c in cues.iter().filter(|c| c.1 > w.start - MAX_SHIFT - 1.0 && c.0 < end + MAX_SHIFT + 1.0) {
        match near.last_mut() {
            Some(last) if c.0 <= last.1 => last.1 = last.1.max(c.1),
            _ => near.push(c),
        }
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let bin = |t: f64| ((t - w.start) / step - 0.5).ceil().clamp(0.0, as_f64(bins)) as usize;
    // delay d_k = (k − half)·step; a line at cue time a shows at film a + d.
    let scores: Vec<f64> = (0..=2 * half)
        .map(|k| {
            let d = (as_f64(k) - as_f64(half)) * step;
            near.iter().map(|&(a, b)| sum[bin(b + d)] - sum[bin(a + d)]).sum()
        })
        .collect();
    let (best_k, best) = scores
        .iter()
        .copied()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(&b.1))?;
    if best <= 0.0 {
        return None;
    }
    let second = scores
        .iter()
        .enumerate()
        .filter(|(k, _)| k.abs_diff(best_k) > COARSE)
        .map(|(_, s)| *s)
        .fold(f64::MIN, f64::max);
    let sharp = if second > 0.0 { best / second } else { 10.0 };
    let coarse_delay = (as_f64(best_k) - as_f64(half)) * step;
    // Fine: 10 ms within half a second of the coarse answer, by where lines
    // *start* against where speech starts. A line stays up a while after the
    // words end, by an amount that differs line to line, so lining up whole
    // lines leaves a plateau; their starts are tight.
    let onsets: Vec<f64> = (1..n)
        .filter(|&i| w.on[i] && !w.on[i - 1])
        .map(|i| w.start + as_f64(i) * RES)
        .collect();
    let starts: Vec<f64> = cues.iter().map(|c| c.0).collect();
    let fine = |d: f64| -> f64 {
        onsets
            .iter()
            .map(|&t| {
                let at = starts.partition_point(|&s| s + d < t);
                let near = [at.wrapping_sub(1), at]
                    .iter()
                    .filter_map(|&j| starts.get(j))
                    .map(|&s| (s + d - t).abs())
                    .fold(f64::MAX, f64::min);
                (1.0 - near / ONSET_REACH).max(0.0)
            })
            .sum()
    };
    let delay = (-50..=50)
        .map(|j| coarse_delay + f64::from(j) * RES)
        .map(|d| (d, fine(d)))
        .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.abs().total_cmp(&a.0.abs())))
        .filter(|(_, score)| *score > 0.0)
        .map_or(coarse_delay, |(d, _)| d - w.lead);
    // A stretch with hardly any lines in it under that delay has no say.
    let end = w.start + as_f64(n) * RES;
    let inside = cues.iter().filter(|c| c.1 + delay > w.start && c.0 + delay < end).count();
    (inside >= 3).then_some((delay, sharp))
}

/// The largest group of votes within [`AGREE_WITHIN`] of one another:
/// (members, their spread). Ties go to the tighter group.
fn largest_group(delays: &[f64]) -> (Vec<f64>, f64) {
    let mut best: (Vec<f64>, f64) = (Vec::new(), f64::MAX);
    for &centre in delays {
        let members: Vec<f64> = delays.iter().copied().filter(|d| (d - centre).abs() <= AGREE_WITHIN).collect();
        let spread = members.iter().map(|d| (d - centre).abs()).fold(0.0, f64::max);
        if members.len() > best.0.len() || (members.len() == best.0.len() && spread < best.1) {
            best = (members, spread);
        }
    }
    best
}

fn median(values: &[f64]) -> f64 {
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    if v.is_empty() {
        0.0
    } else if v.len() % 2 == 1 {
        v[v.len() / 2]
    } else {
        (v[v.len() / 2 - 1] + v[v.len() / 2]) / 2.0
    }
}

/// Every stretch votes at every speed; the speed whose votes agree most wins,
/// and acts only if [`MIN_AGREE`], [`AGREE_SHARE`] and a majority all hold.
pub fn fit(cues: &[(f64, f64)], windows: &[Window]) -> Finding {
    let checks = windows.len();
    if cues.len() < MIN_CUES {
        return Finding::plain(Outcome::NoLines, checks);
    }
    // (speed index, group, spread, votes that were sharp enough)
    let mut best: Option<(usize, Vec<f64>, f64, Vec<f64>)> = None;
    for (index, &pair) in SPEEDS.iter().enumerate() {
        let speed = speed_of(pair);
        let delays: Vec<f64> = windows
            .iter()
            .filter_map(|w| vote(cues, w, speed))
            .filter(|&(_, sharp)| sharp >= MIN_SHARPNESS)
            .map(|(d, _)| d)
            .collect();
        let (group, spread) = largest_group(&delays);
        let better = match &best {
            None => true,
            Some((_, g, s, _)) => group.len() > g.len() || (group.len() == g.len() && spread < *s - 1e-9),
        };
        if better {
            best = Some((index, group, spread, delays));
        }
    }
    let Some((index, group, _, votes)) = best else {
        return Finding::plain(Outcome::Unsure, checks);
    };
    let agree = group.len();
    let usable = votes.len();
    let pair = SPEEDS[index];
    let delay = (median(&group) * 1000.0).round() / 1000.0;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let share_needed = (AGREE_SHARE * as_f64(usable)).ceil() as usize;
    let rest: Vec<f64> = votes.iter().copied().filter(|d| (d - median(&group)).abs() > AGREE_WITHIN).collect();
    let second = largest_group(&rest).0.len();
    let agreed = agree >= MIN_AGREE && agree >= share_needed && 2 * agree > checks && second < 2;
    let outcome = if agreed {
        if index == 0 && delay.abs() < IN_TIME { Outcome::InTime } else { Outcome::Fixed }
    } else if agree >= 2 && second >= 2 && agree + second >= MIN_AGREE && agree + second >= share_needed {
        Outcome::OtherCut
    } else {
        Outcome::Unsure
    };
    let moved = outcome == Outcome::Fixed;
    Finding {
        outcome,
        delay_secs: if moved { delay } else { 0.0 },
        speed: if moved { speed_of(pair) } else { 1.0 },
        from_fps: if moved { pair.0 } else { 1.0 },
        to_fps: if moved { pair.1 } else { 1.0 },
        agree,
        usable,
        checks,
        reference: String::new(),
        millis: 0,
    }
}

/// Where the stretches start: spread over 10–90 % of the film, past opening
/// logos and before the credits, never closer than one stretch apart.
pub fn window_starts(duration: f64) -> Vec<f64> {
    if !(duration.is_finite() && duration >= MIN_DURATION) {
        return Vec::new();
    }
    let span = duration * 0.8 - WINDOW_SECS;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let fit = ((span / (WINDOW_SECS * 1.5)).floor() as usize + 1).clamp(MIN_AGREE, WINDOWS);
    (0..fit)
        .map(|i| duration * 0.1 + span * as_f64(i) / as_f64(fit - 1))
        .collect()
}

/// A built-in subtitle's lines as an on/off signal over a stretch.
pub fn cue_signal(cues: &[(f64, f64)], start: f64, len: f64) -> Vec<bool> {
    let mut sorted = cues.to_vec();
    sorted.sort_by(|a, b| a.0.total_cmp(&b.0));
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let n = (len / RES).round() as usize;
    (0..n).map(|i| showing(&sorted, start + as_f64(i) * RES)).collect()
}

/// Speech in 16 kHz mono sound, on or off every [`RES`]: energy in the voice
/// band (one-pole filters at ~300 and ~3400 Hz) rising [`RISE_DB`] above its
/// own half-second average, with short gaps closed and short blips dropped.
/// All quiet → all off.
pub fn speech(pcm: &[i16], rate: u32) -> Vec<bool> {
    let rate_f = f64::from(rate);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let frame = (rate_f * RES).round() as usize;
    if frame == 0 || pcm.len() < frame {
        return Vec::new();
    }
    let hp = (-2.0 * std::f64::consts::PI * 300.0 / rate_f).exp();
    let lp = 1.0 - (-2.0 * std::f64::consts::PI * 3400.0 / rate_f).exp();
    let (mut prev_x, mut hp_y, mut lp_y) = (0.0_f64, 0.0_f64, 0.0_f64);
    let mut db: Vec<f64> = Vec::with_capacity(pcm.len() / frame);
    let mut energy = 0.0;
    for (i, &s) in pcm.iter().enumerate() {
        let x = f64::from(s) / 32768.0;
        hp_y = hp * (hp_y + x - prev_x);
        prev_x = x;
        lp_y += lp * (hp_y - lp_y);
        energy += lp_y * lp_y;
        if (i + 1) % frame == 0 {
            db.push(10.0 * (energy / as_f64(frame) + 1e-12).log10());
            energy = 0.0;
        }
    }
    // A little smoothing: three frames.
    let smooth: Vec<f64> = (0..db.len())
        .map(|i| {
            let lo = i.saturating_sub(1);
            let hi = (i + 2).min(db.len());
            db[lo..hi].iter().sum::<f64>() / as_f64(hi - lo)
        })
        .collect();
    let mut sorted = smooth.clone();
    sorted.sort_by(f64::total_cmp);
    if sorted[(sorted.len() - 1) * 95 / 100] < -60.0 {
        return vec![false; smooth.len()];
    }
    // Speech comes in syllables: energy rising above its own half-second
    // average. Music and effects under it are steadier, and a fixed threshold
    // over the stretch counted them as speech (measured on a real film: 40–80 %
    // of every stretch "speech", 3 of 8 stretches agreeing; this way 6 of 8).
    let mut sum = vec![0.0; smooth.len() + 1];
    for (i, d) in smooth.iter().enumerate() {
        sum[i + 1] = sum[i] + d;
    }
    let mut on: Vec<bool> = (0..smooth.len())
        .map(|i| {
            let lo = i.saturating_sub(AVERAGE_FRAMES / 2);
            let hi = (i + AVERAGE_FRAMES / 2).min(smooth.len());
            smooth[i] - (sum[hi] - sum[lo]) / as_f64(hi - lo) > RISE_DB
        })
        .collect();
    close_gaps(&mut on, 20, true);
    close_gaps(&mut on, 8, false);
    on
}

/// Runs of `!value` shorter than `max` between two runs of `value` become
/// `value` (gaps closed when `value` is true, blips dropped when false).
fn close_gaps(on: &mut [bool], max: usize, value: bool) {
    let mut i = 0;
    while i < on.len() {
        if on[i] == value {
            i += 1;
            continue;
        }
        let start = i;
        while i < on.len() && on[i] != value {
            i += 1;
        }
        let bounded = if value { start > 0 && i < on.len() } else { true };
        if bounded && i - start < max {
            on[start..i].iter_mut().for_each(|b| *b = value);
        }
    }
}

// ---- reading the film (desktop) ---------------------------------------------

/// Check the subtitle file `subtitle` against the film `video`. `reference`
/// is a built-in text subtitle's track number to compare with where the film
/// has one; `aid` the sound track playing, and `centre` whether it has a
/// centre channel (5.1, 7.1), where the dialogue is. One check at a time.
#[tauri::command]
pub async fn sub_timing_check(
    video: String,
    subtitle: String,
    aid: Option<i64>,
    centre: bool,
    reference: Option<i64>,
    duration: f64,
) -> Result<Finding, String> {
    crate::jobs::off_main(move || check(&video, &subtitle, aid, centre, reference, duration)).await
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn check(
    video: &str,
    subtitle: &str,
    aid: Option<i64>,
    centre: bool,
    reference: Option<i64>,
    duration: f64,
) -> Result<Finding, String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};
    static BUSY: AtomicBool = AtomicBool::new(false);
    struct Free;
    impl Drop for Free {
        fn drop(&mut self) {
            BUSY.store(false, Ordering::SeqCst);
        }
    }
    /// A built-in subtitle's stretch that takes longer than this (the video
    /// is decoded for it) leaves the rest to speech.
    const SUBS_BUDGET: Duration = Duration::from_secs(6);

    if BUSY.swap(true, Ordering::SeqCst) {
        return Err("A timing check is already running.".into());
    }
    let _free = Free;
    let _low = crate::jobs::background();
    let started = Instant::now();
    let text = std::fs::read(subtitle).map_err(|_| "This subtitle file could not be read.".to_string())?;
    let cues = crate::subtitle_files::cues_of(&String::from_utf8_lossy(&text));
    let starts = window_starts(duration);
    let mut finding = if cues.len() < MIN_CUES {
        Finding::plain(Outcome::NoLines, 0)
    } else if starts.is_empty() {
        Finding::plain(Outcome::TooShort, 0)
    } else {
        let mut windows = Vec::new();
        let (mut by_subs, mut by_speech) = (0, 0);
        let mut use_subs = reference.is_some();
        let pcm_file = std::env::temp_dir().join(format!("skrin-timing-{}.pcm", std::process::id()));
        for &start in &starts {
            if let Some(sid) = reference.filter(|_| use_subs) {
                let t = Instant::now();
                let found = read::cues(video, sid, start, WINDOW_SECS);
                if t.elapsed() > SUBS_BUDGET {
                    crate::log!("subtitle timing: the built-in subtitle took {} ms a stretch; speech for the rest", t.elapsed().as_millis());
                    use_subs = false;
                }
                if let Some(found) = found.filter(|c| c.len() >= 3) {
                    windows.push(Window { start, on: cue_signal(&found, start, WINDOW_SECS), lead: 0.0 });
                    by_subs += 1;
                    continue;
                }
            }
            let mut pcm = read::pcm(video, aid, centre, start, WINDOW_SECS, &pcm_file);
            if pcm.is_none() && centre {
                // A track without a centre after all: the whole mix.
                pcm = read::pcm(video, aid, false, start, WINDOW_SECS, &pcm_file);
            }
            if let Some(pcm) = pcm {
                windows.push(Window { start, on: speech(&pcm, read::RATE), lead: LEAD });
                by_speech += 1;
            }
        }
        let _ = std::fs::remove_file(&pcm_file);
        let mut f = fit(&cues, &windows);
        f.checks = starts.len();
        f.reference = match (by_subs, by_speech) {
            (0, _) => "speech",
            (_, 0) => "subtitles",
            _ => "both",
        }
        .into();
        if windows.is_empty() {
            f.outcome = Outcome::Unsure;
        }
        f
    };
    finding.millis = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    crate::log!(
        "subtitle timing: {:?}, delay {:+.3} s, speed {:.5}, {} of {} agree ({} voted), against {}, {} ms",
        finding.outcome,
        finding.delay_secs,
        finding.speed,
        finding.agree,
        finding.checks,
        finding.usable,
        finding.reference,
        finding.millis
    );
    Ok(finding)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn check(_: &str, _: &str, _: Option<i64>, _: bool, _: Option<i64>, _: f64) -> Result<Finding, String> {
    Err("Automatic subtitle timing needs mpv.".into())
}

/// The second libmpv handle, opened per stretch and closed after (closing is
/// what finishes the sound file `ao=pcm` writes).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod read {
    use std::collections::BTreeMap;
    use std::ffi::{c_char, c_int, c_void, CStr, CString};
    use std::path::Path;
    use std::time::{Duration, Instant};

    pub const RATE: u32 = 16_000;

    #[repr(C)]
    struct Event {
        event_id: c_int,
        error: c_int,
        reply_userdata: u64,
        data: *mut c_void,
    }

    type Create = unsafe extern "C" fn() -> *mut c_void;
    type SetOption = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
    type Initialize = unsafe extern "C" fn(*mut c_void) -> c_int;
    type Command = unsafe extern "C" fn(*mut c_void, *mut *const c_char) -> c_int;
    type WaitEvent = unsafe extern "C" fn(*mut c_void, f64) -> *mut Event;
    type GetString = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_char;
    type Observe = unsafe extern "C" fn(*mut c_void, u64, *const c_char, c_int) -> c_int;
    type Free = unsafe extern "C" fn(*mut c_void);
    type Destroy = unsafe extern "C" fn(*mut c_void);

    const EVENT_SHUTDOWN: c_int = 1;
    const EVENT_END_FILE: c_int = 7;
    const EVENT_IDLE: c_int = 11;
    const EVENT_PROPERTY_CHANGE: c_int = 22;
    const FORMAT_DOUBLE: c_int = 5;

    /// One stretch, opening included; a share that does not answer is given up.
    const STRETCH_WAIT: Duration = Duration::from_secs(45);

    struct Handle {
        ptr: *mut c_void,
        command: Command,
        wait: WaitEvent,
        get_string: GetString,
        observe: Observe,
        free: Free,
        destroy: Destroy,
    }

    impl Handle {
        fn open(options: &[(&str, String)]) -> Option<Self> {
            let lib = crate::videos::mpv_frame::library()?;
            // SAFETY: libmpv's client API (client.h), stable across 2.x; the
            // handle is used on this thread only and destroyed in `drop`.
            unsafe {
                let create: Create = *lib.get::<Create>(b"mpv_create\0").ok()?;
                let set: SetOption = *lib.get::<SetOption>(b"mpv_set_option_string\0").ok()?;
                let init: Initialize = *lib.get::<Initialize>(b"mpv_initialize\0").ok()?;
                let mut handle = Self {
                    ptr: std::ptr::null_mut(),
                    command: *lib.get::<Command>(b"mpv_command\0").ok()?,
                    wait: *lib.get::<WaitEvent>(b"mpv_wait_event\0").ok()?,
                    get_string: *lib.get::<GetString>(b"mpv_get_property_string\0").ok()?,
                    observe: *lib.get::<Observe>(b"mpv_observe_property\0").ok()?,
                    free: *lib.get::<Free>(b"mpv_free\0").ok()?,
                    destroy: *lib.get::<Destroy>(b"mpv_terminate_destroy\0").ok()?,
                };
                let ptr = create();
                if ptr.is_null() {
                    return None;
                }
                handle.ptr = ptr;
                let common: &[(&str, &str)] = &[
                    ("config", "no"),
                    ("terminal", "no"),
                    ("vo", "null"),
                    ("untimed", "yes"),
                    ("idle", "yes"),
                    ("keep-open", "no"),
                    ("sub-auto", "no"),
                    ("audio-file-auto", "no"),
                    ("cache", "no"),
                    ("ytdl", "no"),
                    ("load-scripts", "no"),
                    ("osc", "no"),
                    ("input-default-bindings", "no"),
                    ("hwdec", "no"),
                ];
                let all = common.iter().map(|(n, v)| (*n, (*v).to_string())).chain(options.iter().cloned());
                for (name, value) in all {
                    let (Ok(name), Ok(value)) = (CString::new(name), CString::new(value)) else {
                        return None;
                    };
                    set(ptr, name.as_ptr(), value.as_ptr());
                }
                (init(ptr) >= 0).then_some(handle)
            }
        }

        fn run(&self, args: &[&str]) -> bool {
            let owned: Vec<CString> = args.iter().filter_map(|a| CString::new(*a).ok()).collect();
            if owned.len() != args.len() {
                return false;
            }
            let mut ptrs: Vec<*const c_char> = owned.iter().map(|a| a.as_ptr()).collect();
            ptrs.push(std::ptr::null());
            // SAFETY: a null-terminated array of C strings that outlive the call.
            unsafe { (self.command)(self.ptr, ptrs.as_mut_ptr()) >= 0 }
        }

        fn get(&self, name: &str) -> Option<f64> {
            let name = CString::new(name).ok()?;
            // SAFETY: a string property; the copy mpv returns is freed with mpv_free.
            unsafe {
                let value = (self.get_string)(self.ptr, name.as_ptr());
                if value.is_null() {
                    return None;
                }
                let read = CStr::from_ptr(value).to_str().ok().and_then(|s| s.parse().ok());
                (self.free)(value.cast());
                read
            }
        }

        fn watch(&self, name: &str) {
            if let Ok(c) = CString::new(name) {
                // SAFETY: mpv copies the name.
                unsafe { (self.observe)(self.ptr, 0, c.as_ptr(), FORMAT_DOUBLE) };
            }
        }

        /// Wait for the file to end, calling `changed` on every property change.
        fn until_end(&self, mut changed: impl FnMut(&Self)) -> bool {
            let started = Instant::now();
            let mut loaded = false;
            while started.elapsed() < STRETCH_WAIT {
                // SAFETY: the event belongs to mpv and is read before the next wait.
                let id = unsafe {
                    let event = (self.wait)(self.ptr, 0.25);
                    if event.is_null() { 0 } else { (*event).event_id }
                };
                match id {
                    EVENT_PROPERTY_CHANGE => {
                        loaded = true;
                        changed(self);
                    }
                    EVENT_END_FILE | EVENT_SHUTDOWN => return true,
                    EVENT_IDLE if loaded => return true,
                    _ => {}
                }
            }
            false
        }
    }

    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: made by mpv_create, destroyed once.
            unsafe { (self.destroy)(self.ptr) };
        }
    }

    fn window_options(start: f64, len: f64) -> Vec<(&'static str, String)> {
        vec![("start", format!("{start:.3}")), ("end", format!("{:.3}", start + len)), ("hr-seek", "yes".into())]
    }

    /// The sound of `len` seconds from `start`: 16 kHz mono, as mpv decodes it.
    pub fn pcm(video: &str, aid: Option<i64>, centre: bool, start: f64, len: f64, out: &Path) -> Option<Vec<i16>> {
        let _ = std::fs::remove_file(out);
        let mut options = window_options(start, len);
        options.extend([
            ("vid", "no".to_string()),
            ("sid", "no".into()),
            ("aid", aid.map_or("auto".into(), |a| a.to_string())),
            ("ao", "pcm".into()),
            ("ao-pcm-file", out.to_str()?.to_string()),
            ("ao-pcm-waveheader", "no".into()),
            ("audio-format", "s16".into()),
            ("audio-samplerate", RATE.to_string()),
            ("audio-channels", "mono".into()),
            ("audio-spdif", "".into()),
            ("gapless-audio", "no".into()),
            ("replaygain", "no".into()),
        ]);
        // Where the film has a centre channel, the dialogue is in it: the
        // music and effects around it would otherwise count as speech.
        if centre {
            options.push(("af", "lavfi=[pan=mono|c0=FC]".into()));
        }
        {
            let handle = Handle::open(&options)?;
            if !handle.run(&["loadfile", video]) || !handle.until_end(|_| {}) {
                return None;
            }
            // Dropped here: the sound file is finished.
        }
        let bytes = std::fs::read(out).ok()?;
        let _ = std::fs::remove_file(out);
        let samples: Vec<i16> = bytes.as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b)).collect();
        (samples.len() > RATE as usize).then_some(samples)
    }

    /// The built-in subtitle `sid`'s lines that show in `len` seconds from
    /// `start`. The video is decoded (fast, small, on the processor): with
    /// `vid=no` mpv misses most cues.
    pub fn cues(video: &str, sid: i64, start: f64, len: f64) -> Option<Vec<(f64, f64)>> {
        let mut options = window_options(start, len);
        options.extend([
            ("vid", "auto".to_string()),
            ("aid", "no".into()),
            ("ao", "null".into()),
            ("sid", sid.to_string()),
            ("vd-lavc-threads", "4".into()),
            ("vd-lavc-fast", "yes".into()),
            ("vd-lavc-skiploopfilter", "all".into()),
        ]);
        let handle = Handle::open(&options)?;
        handle.watch("sub-start");
        handle.watch("sub-end");
        if !handle.run(&["loadfile", video]) {
            return None;
        }
        let mut found: BTreeMap<i64, f64> = BTreeMap::new();
        let done = handle.until_end(|h| {
            if let (Some(a), Some(b)) = (h.get("sub-start"), h.get("sub-end")) {
                if b > a {
                    #[allow(clippy::cast_possible_truncation)]
                    found.insert((a * 1000.0).round() as i64, b);
                }
            }
        });
        #[allow(clippy::cast_precision_loss)]
        let cues: Vec<(f64, f64)> = found.into_iter().map(|(a, b)| (a as f64 / 1000.0, b)).collect();
        done.then_some(cues)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A small, repeatable random source for made-up films.
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
            as_f64(usize::try_from(self.0 >> 40).unwrap()) / as_f64(1 << 24)
        }
        fn between(&mut self, a: f64, b: f64) -> f64 {
            a + (b - a) * self.next()
        }
    }

    /// A made-up film's speech: lines of 0.8–4 s with gaps of 0.3–3 s, and a
    /// quiet stretch now and then, from 30 s to `len`.
    pub(super) fn speech_of(len: f64, seed: u64) -> Vec<(f64, f64)> {
        let mut rng = Lcg(seed);
        let mut t = 30.0;
        let mut lines = Vec::new();
        while t < len {
            let d = rng.between(0.8, 4.0);
            lines.push((t, t + d));
            t += d + if rng.next() < 0.08 { rng.between(8.0, 25.0) } else { rng.between(0.3, 3.0) };
        }
        lines
    }

    /// A subtitle for that speech, as people make them: a line shows a little
    /// before it is said and stays a little after, some lines are left out,
    /// and its times are as the subtitle's own release had them —
    /// cue = (film − delay) / speed.
    pub(super) fn subtitle_for(speech: &[(f64, f64)], delay: f64, speed: f64, seed: u64) -> Vec<(f64, f64)> {
        let mut rng = Lcg(seed);
        speech
            .iter()
            .filter_map(|&(a, b)| {
                if rng.next() <= 0.1 {
                    return None;
                }
                let a = a - rng.between(0.0, 0.25);
                let b = b + rng.between(0.2, 0.8);
                Some(((a - delay) / speed, (b - delay) / speed))
            })
            .collect()
    }

    /// The reference as the reading gives it: speech on/off, with some noise
    /// (a door, music) on and some words missed.
    pub(super) fn windows_for(speech: &[(f64, f64)], duration: f64, seed: u64) -> Vec<Window> {
        let mut rng = Lcg(seed);
        window_starts(duration)
            .into_iter()
            .map(|start| {
                let mut on = cue_signal(speech, start, WINDOW_SECS);
                let mut i = 0;
                while i < on.len() {
                    if rng.next() < 0.004 {
                        let len = (rng.between(10.0, 80.0)) as usize;
                        let flip = rng.next() < 0.5;
                        for b in on.iter_mut().skip(i).take(len) {
                            *b = flip;
                        }
                        i += len;
                    }
                    i += 1;
                }
                Window { start, on, lead: LEAD }
            })
            .collect()
    }

    const FILM: f64 = 2.0 * 3600.0;

    #[test]
    fn a_subtitle_2_5_s_late_is_found_to_the_tenth() {
        let speech = speech_of(FILM, 1);
        let sub = subtitle_for(&speech, 2.5, 1.0, 2);
        let f = fit(&sub, &windows_for(&speech, FILM, 3));
        assert_eq!(f.outcome, Outcome::Fixed, "{f:?}");
        assert!((f.delay_secs - 2.5).abs() < 0.1, "{f:?}");
        assert!((f.speed - 1.0).abs() < 1e-9);
        assert!(f.agree >= 6, "{f:?}");
    }

    #[test]
    fn a_built_in_subtitle_as_reference_gives_the_exact_shift_without_speech_lead() {
        // Real-app finding (round 10 proof): with the film's own subtitle as the
        // reference the answer was 0.195 s off, because LEAD (for speech) was given back.
        let speech = speech_of(FILM, 41);
        let built_in = subtitle_for(&speech, 0.0, 1.0, 42);
        let late: Vec<(f64, f64)> = built_in.iter().map(|&(a, b)| (a + 2.5, b + 2.5)).collect();
        let windows: Vec<Window> = window_starts(FILM)
            .into_iter()
            .map(|start| Window { start, on: cue_signal(&built_in, start, WINDOW_SECS), lead: 0.0 })
            .collect();
        let f = fit(&late, &windows);
        assert_eq!(f.outcome, Outcome::Fixed, "{f:?}");
        assert!((f.delay_secs + 2.5).abs() < 0.03, "{f:?}");
    }

    #[test]
    fn a_subtitle_early_by_a_minute_is_found() {
        let speech = speech_of(FILM, 11);
        let sub = subtitle_for(&speech, -61.3, 1.0, 12);
        let f = fit(&sub, &windows_for(&speech, FILM, 13));
        assert_eq!(f.outcome, Outcome::Fixed, "{f:?}");
        assert!((f.delay_secs + 61.3).abs() < 0.1, "{f:?}");
    }

    #[test]
    fn a_25_fps_subtitle_on_a_23_976_film_drifts_and_is_found_with_its_speed() {
        let speech = speech_of(FILM, 21);
        let speed = 25.0 / 23.976;
        let sub = subtitle_for(&speech, 1.2, speed, 22);
        // Unfixed, the end is off by minutes: a fixed shift cannot help.
        assert!((sub.last().unwrap().0 * speed - sub.last().unwrap().0) > 200.0);
        let f = fit(&sub, &windows_for(&speech, FILM, 23));
        assert_eq!(f.outcome, Outcome::Fixed, "{f:?}");
        assert_eq!((f.from_fps, f.to_fps), (25.0, 23.976));
        assert!((f.delay_secs - 1.2).abs() < 0.1, "{f:?}");
    }

    #[test]
    fn the_other_way_23_976_on_25_is_found_too() {
        let speech = speech_of(FILM, 31);
        let sub = subtitle_for(&speech, -0.8, 23.976 / 25.0, 32);
        let f = fit(&sub, &windows_for(&speech, FILM, 33));
        assert_eq!(f.outcome, Outcome::Fixed, "{f:?}");
        assert_eq!((f.from_fps, f.to_fps), (23.976, 25.0));
        assert!((f.delay_secs + 0.8).abs() < 0.1, "{f:?}");
    }

    #[test]
    fn a_subtitle_in_time_is_left_alone() {
        let speech = speech_of(FILM, 41);
        let sub = subtitle_for(&speech, 0.0, 1.0, 42);
        let f = fit(&sub, &windows_for(&speech, FILM, 43));
        assert_eq!(f.outcome, Outcome::InTime, "{f:?}");
        assert_eq!((f.delay_secs, f.speed), (0.0, 1.0));
    }

    #[test]
    fn a_subtitle_for_another_film_cannot_be_told_and_nothing_moves() {
        let speech = speech_of(FILM, 51);
        let other = subtitle_for(&speech_of(FILM, 99), 0.0, 1.0, 52);
        let f = fit(&other, &windows_for(&speech, FILM, 53));
        assert_eq!(f.outcome, Outcome::Unsure, "{f:?}");
        assert_eq!((f.delay_secs, f.speed), (0.0, 1.0));
    }

    #[test]
    fn across_many_made_up_films_a_fix_is_never_wrong() {
        // The rule that matters: a wrong fix is worse than none. Every speed,
        // six films each; also six films with another film's subtitle.
        let mut found = 0;
        let mut tried = 0;
        for (i, &pair) in SPEEDS.iter().enumerate() {
            for seed in 0..6_u64 {
                let base = 1000 + 100 * i as u64 + 3 * seed;
                let speech = speech_of(FILM, base);
                let delay = (seed as f64 - 5.0) * 7.3 + 0.4;
                let sub = subtitle_for(&speech, delay, speed_of(pair), base + 1);
                let f = fit(&sub, &windows_for(&speech, FILM, base + 2));
                tried += 1;
                match f.outcome {
                    Outcome::Fixed => {
                        assert!((f.delay_secs - delay).abs() < 0.15, "{pair:?} {delay}: {f:?}");
                        assert_eq!((f.from_fps, f.to_fps), pair, "{f:?}");
                        found += 1;
                    }
                    Outcome::Unsure => {}
                    other => panic!("{pair:?} {delay}: {other:?}"),
                }
                let other = subtitle_for(&speech_of(FILM, base + 50), 0.0, 1.0, base + 3);
                let f = fit(&other, &windows_for(&speech, FILM, base + 2));
                assert!(matches!(f.outcome, Outcome::Unsure | Outcome::OtherCut), "{f:?}");
            }
        }
        assert!(found * 10 >= tried * 9, "found {found} of {tried}");
    }

    #[test]
    fn music_only_cannot_be_told() {
        let speech = speech_of(FILM, 61);
        let sub = subtitle_for(&speech, 3.0, 1.0, 62);
        let windows: Vec<Window> = window_starts(FILM)
            .into_iter()
            .map(|start| Window { start, on: vec![true; 4000], lead: LEAD })
            .collect();
        assert_eq!(fit(&sub, &windows).outcome, Outcome::Unsure);
    }

    #[test]
    fn a_subtitle_for_another_cut_splits_the_votes_and_says_so() {
        let speech = speech_of(FILM, 71);
        // The first half in time, the second 30 s late: a scene cut out.
        let half = FILM / 2.0;
        let mut sub = subtitle_for(&speech.iter().copied().filter(|l| l.0 < half).collect::<Vec<_>>(), 0.0, 1.0, 72);
        sub.extend(subtitle_for(&speech.iter().copied().filter(|l| l.0 >= half).collect::<Vec<_>>(), -30.0, 1.0, 73));
        let f = fit(&sub, &windows_for(&speech, FILM, 74));
        assert_eq!(f.outcome, Outcome::OtherCut, "{f:?}");
        assert_eq!(f.delay_secs, 0.0);
    }

    #[test]
    fn an_episode_is_checked_with_fewer_stretches() {
        let len = 22.0 * 60.0;
        assert!(window_starts(len).len() >= MIN_AGREE);
        let speech = speech_of(len, 81);
        let sub = subtitle_for(&speech, -1.7, 1.0, 82);
        let f = fit(&sub, &windows_for(&speech, len, 83));
        assert_eq!(f.outcome, Outcome::Fixed, "{f:?}");
        assert!((f.delay_secs + 1.7).abs() < 0.1, "{f:?}");
    }

    #[test]
    fn a_short_clip_and_a_near_empty_file_are_not_checked() {
        assert!(window_starts(5.0 * 60.0).is_empty());
        assert_eq!(fit(&[(1.0, 2.0); 5], &[]).outcome, Outcome::NoLines);
    }

    #[test]
    fn stretches_lie_inside_the_film_past_the_opening() {
        let starts = window_starts(FILM);
        assert_eq!(starts.len(), WINDOWS);
        assert!(starts[0] >= FILM * 0.1 - 1e-6);
        assert!(starts.last().unwrap() + WINDOW_SECS <= FILM * 0.9 + 1e-6);
    }


    /// On a real film, by hand: `SKRIN_TIMING_VIDEO`, `SKRIN_TIMING_SUB` and
    /// `SKRIN_TIMING_DURATION` (seconds); prints every stretch's votes. Needs
    /// libmpv where `videos::mpv_frame::library` looks (beside the test, or
    /// its `lib` folder). `cargo test --lib real_film -- --ignored --nocapture`
    #[test]
    #[ignore = "reads a real film"]
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn real_film() {
        let (Ok(video), Ok(sub), Ok(duration)) = (
            std::env::var("SKRIN_TIMING_VIDEO"),
            std::env::var("SKRIN_TIMING_SUB"),
            std::env::var("SKRIN_TIMING_DURATION"),
        ) else {
            return;
        };
        let duration: f64 = duration.parse().unwrap();
        let text = std::fs::read(&sub).unwrap();
        let cues = crate::subtitle_files::cues_of(&String::from_utf8_lossy(&text));
        let out = std::env::temp_dir().join("skrin-timing-test.pcm");
        eprintln!("libmpv: {}, video {video}", crate::videos::mpv_frame::library().is_some());
        let windows: Vec<Window> = window_starts(duration)
            .into_iter()
            .filter_map(|start| {
                let pcm = super::read::pcm(&video, None, std::env::var("SKRIN_TIMING_CENTRE").is_ok(), start, WINDOW_SECS, &out)?;
                if let Ok(dir) = std::env::var("SKRIN_TIMING_DUMP") {
                    let bytes: Vec<u8> = pcm.iter().flat_map(|s| s.to_le_bytes()).collect();
                    std::fs::write(std::path::Path::new(&dir).join(format!("{start:.0}.pcm")), bytes).unwrap();
                }
                let on = speech(&pcm, super::read::RATE);
                eprintln!("window {start:.0}: {} frames, {:.0} % speech", on.len(), 100.0 * as_f64(on.iter().filter(|&&b| b).count()) / as_f64(on.len()));
                Some(Window { start, on, lead: LEAD })
            })
            .collect();
        for &pair in &SPEEDS {
            let votes: Vec<String> = windows
                .iter()
                .map(|w| vote(&cues, w, speed_of(pair)).map_or("-".into(), |(d, s)| format!("{d:+.2}/{s:.2}")))
                .collect();
            eprintln!("{pair:?}: {}", votes.join("  "));
        }
        eprintln!("{:?}", fit(&cues, &windows));
    }

    /// Made-up sound: quiet noise, and in each speech line a voice-like tone
    /// (a 150 Hz buzz with its harmonics, wobbling at 4 Hz) well above it.
    fn sound(len: f64, lines: &[(f64, f64)]) -> Vec<i16> {
        let rate = f64::from(read_rate());
        let mut rng = Lcg(7);
        let n = (len * rate) as usize;
        (0..n)
            .map(|i| {
                let t = as_f64(i) / rate;
                let mut x = (rng.next() - 0.5) * 0.02;
                if lines.iter().any(|&(a, b)| t >= a && t < b) {
                    let wobble = 0.6 + 0.4 * (2.0 * std::f64::consts::PI * 4.0 * t).sin();
                    let voice: f64 = (1..=12)
                        .map(|h| (2.0 * std::f64::consts::PI * 150.0 * f64::from(h) * t).sin() / f64::from(h))
                        .sum();
                    x += 0.15 * wobble * voice;
                }
                (x.clamp(-1.0, 1.0) * 32767.0) as i16
            })
            .collect()
    }

    fn read_rate() -> u32 {
        16_000
    }

    #[test]
    fn speech_is_found_in_made_up_sound() {
        let lines = [(1.0, 3.5), (4.2, 6.0), (9.0, 13.0), (15.5, 16.5)];
        let on = speech(&sound(18.0, &lines), read_rate());
        let truth = cue_signal(&lines, 0.0, 18.0);
        assert_eq!(on.len(), truth.len());
        let same = on.iter().zip(&truth).filter(|(a, b)| a == b).count();
        assert!(as_f64(same) / as_f64(on.len()) > 0.9, "{same} of {}", on.len());
    }

    #[test]
    fn silence_is_no_speech() {
        assert!(speech(&vec![0_i16; 16_000 * 5], read_rate()).iter().all(|b| !b));
    }

    #[test]
    fn found_through_made_up_sound_end_to_end() {
        // The whole path below the reading: sound → speech → fit, 1.5 s late.
        let len = 30.0 * 60.0;
        let lines = speech_of(len, 91);
        let sub = subtitle_for(&lines, 1.5, 1.0, 92);
        let windows: Vec<Window> = window_starts(len)
            .into_iter()
            .map(|start| {
                let local: Vec<(f64, f64)> = lines
                    .iter()
                    .filter(|l| l.1 > start && l.0 < start + WINDOW_SECS)
                    .map(|&(a, b)| (a - start, b - start))
                    .collect();
                Window { start, on: speech(&sound(WINDOW_SECS, &local), read_rate()), lead: LEAD }
            })
            .collect();
        let f = fit(&sub, &windows);
        assert_eq!(f.outcome, Outcome::Fixed, "{f:?}");
        assert!((f.delay_secs - 1.5).abs() < 0.15, "{f:?}");
    }
}
