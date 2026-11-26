import { useEffect } from 'react';

/** Standard Xbox layout, which the Ally exposes in Gamepad mode. */
export function gamepadKeys(buttons: boolean[], axes: readonly number[]): string[] {
  const keys: string[] = [];
  if (buttons[12] || (axes[1] ?? 0) < -0.6) keys.push('ArrowUp');
  if (buttons[13] || (axes[1] ?? 0) > 0.6) keys.push('ArrowDown');
  if (buttons[14] || (axes[0] ?? 0) < -0.6) keys.push('ArrowLeft');
  if (buttons[15] || (axes[0] ?? 0) > 0.6) keys.push('ArrowRight');
  if (buttons[0]) keys.push('Enter');
  if (buttons[1] || buttons[9]) keys.push('Escape');
  if (buttons[2]) keys.push(' ');
  if (buttons[4]) keys.push('PageUp');
  if (buttons[5]) keys.push('PageDown');
  return keys;
}

/** Feed the same navigation path as a keyboard; only while this app has focus. */
export function useGamepadNavigation() {
  useEffect(() => {
    let frame = 0;
    const held = new Map<string, { since: number; last: number }>();
    const poll = (now: number) => {
      const pad = document.hasFocus() ? [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected && p.mapping === 'standard') : null;
      // Both sticks wake the stage; ignore small controller drift.
      if (pad && (pad.axes.some((axis) => Math.abs(axis) > 0.25) || pad.buttons.some((button) => button.pressed))) {
        window.dispatchEvent(new Event('kinema-gamepad-activity'));
      }
      const keys = pad ? gamepadKeys(pad.buttons.map((b) => b.pressed), pad.axes) : [];
      for (const key of held.keys()) if (!keys.includes(key)) held.delete(key);
      for (const key of keys) {
        const old = held.get(key);
        const repeat = !!old;
        // Confirm/back never repeat; held arrows have a normal initial delay.
        if (old && (!key.startsWith('Arrow') || now - old.since < 400 || now - old.last < 150)) continue;
        held.set(key, { since: old?.since ?? now, last: now });
        const target = document.activeElement ?? window;
        target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true, repeat }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, []);
}
