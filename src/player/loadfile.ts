/**
 * `loadfile` with per-file options, on every mpv a system may have.
 *
 * mpv 0.38 put a playlist index in front of the options:
 * `loadfile <url> <flags> <index> <options>`. Before it the form was
 * `loadfile <url> <flags> <options>`, and each version refuses the other's
 * ("invalid parameter"): the newer reads the options as the index, the older
 * reads `-1` as the options. Linux systems that ship mpv 0.37 then could not
 * resume anything (docs/GOTCHAS.md, "`loadfile` is asynchronous").
 *
 * Decided by what mpv answers, not by its version: the newer form first, the
 * older one if that is refused, and the form that worked is kept for the rest
 * of the session. Refusal is only ever about the arguments — whether the file
 * itself opens arrives later, as an event — so trying twice opens nothing twice.
 */

export type MpvCommand = (name: string, args: string[]) => Promise<unknown>;

/** Whether this mpv takes the index; `null` until one load with options has told. */
let takesIndex: boolean | null = null;

/** For tests: forget what the last mpv answered. */
export function resetLoadfileForm(): void {
  takesIndex = null;
}

/** Open `url`, replacing what plays, with `options` (`start=…`) if any. */
export async function loadfile(run: MpvCommand, url: string, options: string | null): Promise<void> {
  if (options === null) {
    await run('loadfile', [url]);
    return;
  }
  if (takesIndex !== false) {
    try {
      await run('loadfile', [url, 'replace', '-1', options]);
      takesIndex = true;
      return;
    } catch (e) {
      // This mpv took the index before: the refusal is real, not the form.
      if (takesIndex === true) throw e;
    }
  }
  // mpv before 0.38.
  await run('loadfile', [url, 'replace', options]);
  if (takesIndex === null) console.warn('player: mpv older than 0.38, loading with its loadfile form');
  takesIndex = false;
}
