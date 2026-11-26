import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadfile, resetLoadfileForm } from './loadfile';

const refused = new Error("Failed to execute command 'loadfile': invalid parameter");

/** An mpv that takes one form of `loadfile` and refuses the other, as each version does. */
function mpv(takesIndex: boolean) {
  const calls: string[][] = [];
  const run = vi.fn(async (_name: string, args: string[]) => {
    calls.push(args);
    if (args.length > 1 && (args.length === 4) !== takesIndex) throw refused;
  });
  return { run, calls };
}

describe('loadfile', () => {
  beforeEach(() => resetLoadfileForm());

  it('sends a plain load without options', async () => {
    const m = mpv(true);
    await loadfile(m.run, 'a.mkv', null);
    expect(m.calls).toEqual([['a.mkv']]);
  });

  it('mpv 0.38 on: the index form, once', async () => {
    const m = mpv(true);
    await loadfile(m.run, 'a.mkv', 'start=600');
    await loadfile(m.run, 'b.mkv', 'start=5');
    expect(m.calls).toEqual([
      ['a.mkv', 'replace', '-1', 'start=600'],
      ['b.mkv', 'replace', '-1', 'start=5'],
    ]);
  });

  it('mpv before 0.38: falls back, then remembers the older form', async () => {
    const m = mpv(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadfile(m.run, 'a.mkv', 'start=600');
    await loadfile(m.run, 'b.mkv', 'start=5');
    expect(m.calls).toEqual([
      ['a.mkv', 'replace', '-1', 'start=600'],
      ['a.mkv', 'replace', 'start=600'],
      ['b.mkv', 'replace', 'start=5'],
    ]);
  });

  it('a refusal from an mpv known to take the index is passed on, not retried', async () => {
    const m = mpv(true);
    await loadfile(m.run, 'a.mkv', 'start=1');
    m.run.mockRejectedValueOnce(new Error('other'));
    await expect(loadfile(m.run, 'b.mkv', 'start=2')).rejects.toThrow('other');
    expect(m.run.mock.calls[m.run.mock.calls.length - 1][1]).toEqual(['b.mkv', 'replace', '-1', 'start=2']);
  });
});
