import { describe, expect, it } from 'vitest';
import type { Track } from './engine';
import {
  builtInReference,
  describeFinding,
  describeOffer,
  hasCentre,
  timableFile,
  worthOffering,
  type TimingFinding,
} from './subTiming';

const found = (over: Partial<TimingFinding>): TimingFinding => ({
  outcome: 'fixed',
  delay_secs: -2.3,
  speed: 1,
  from_fps: 1,
  to_fps: 1,
  agree: 7,
  usable: 7,
  checks: 8,
  reference: 'speech',
  millis: 2000,
  ...over,
});

const track = (over: Partial<Track>): Track => ({
  id: 1,
  type: 'sub',
  selected: false,
  forced: false,
  external: false,
  default: false,
  ...over,
});

describe('automatic subtitle timing, said', () => {
  it('says what moved, how many agree and against what', () => {
    expect(describeFinding(found({}))).toBe(
      'Subtitles 2.3 s earlier — 7 of 8 checks agree, against the speech.'
    );
    expect(
      describeFinding(found({ delay_secs: 1.2, speed: 25 / 23.976, from_fps: 25, to_fps: 23.976, reference: 'subtitles' }))
    ).toBe(
      'Subtitles 1.2 s later, and slowed to match the film (made for 25 fps; the film is 23.976) — 7 of 8 checks agree, against the subtitles built into the film.'
    );
    expect(describeFinding(found({ outcome: 'unsure', agree: 2 }))).toMatch(/^Could not tell .* nothing changed/);
    expect(describeFinding(found({ outcome: 'other_cut' }))).toMatch(/another version of the film/);
  });

  it('offers only when clearly off, in plain words', () => {
    expect(worthOffering(found({ delay_secs: -0.2 }))).toBe(false);
    expect(worthOffering(found({ outcome: 'unsure' }))).toBe(false);
    expect(worthOffering(found({ delay_secs: 0, speed: 1.0427 }))).toBe(true);
    expect(describeOffer(found({}))).toBe('These subtitles look 2.3 s late.');
    expect(describeOffer(found({ delay_secs: 0.5 }))).toBe('These subtitles look 0.5 s early.');
    expect(describeOffer(found({ delay_secs: 0, speed: 1.0427 }))).toBe(
      'These subtitles look made for another frame rate.'
    );
  });

  it('checks text files of their own against a text subtitle inside the film', () => {
    expect(timableFile(track({ external: true, externalFilename: 'C:/a/Film.en.srt' }))).toBe('C:/a/Film.en.srt');
    expect(timableFile(track({ external: true, externalFilename: 'C:/a/Film.sup' }))).toBeNull();
    expect(timableFile(track({ external: false }))).toBeNull();
    const tracks = [
      track({ id: 1, codec: 'hdmv_pgs_subtitle' }),
      track({ id: 2, codec: 'subrip' }),
      track({ id: 3, codec: 'subrip', external: true }),
    ];
    expect(builtInReference(tracks, 3)).toBe(2);
    expect(builtInReference(tracks, 2)).toBeNull();
    expect(hasCentre(track({ type: 'audio', channels: 6 }))).toBe(true);
    expect(hasCentre(track({ type: 'audio', channels: 2, layout: 'stereo' }))).toBe(false);
  });
});
