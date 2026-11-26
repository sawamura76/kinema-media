import { expect, it } from 'vitest';
import { gamepadKeys } from './gamepad';
it('maps Ally/Xbox controls and ignores stick drift', () => {
  expect(gamepadKeys([], [0.2, -0.3])).toEqual([]);
  const buttons: boolean[] = []; buttons[0] = true; buttons[15] = true;
  expect(gamepadKeys(buttons, [0, 0])).toEqual(['ArrowRight', 'Enter']);
  expect(gamepadKeys([], [0, -0.8])).toEqual(['ArrowUp']);
});
