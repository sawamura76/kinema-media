import { describe, expect, it } from 'vitest';
import { bufferedEnd } from './buffered';

describe('bufferedEnd', () => {
  it('ends where the read said, ahead of the play head', () => {
    expect(bufferedEnd({ at: 100, ahead: 60 }, 105, 6000)).toBe(160);
  });
  it('reaches the end once within half a second of it', () => {
    expect(bufferedEnd({ at: 5900, ahead: 99.6 }, 5901, 6000)).toBe(6000);
    expect(bufferedEnd({ at: 100, ahead: 1e6 }, 100, 6000)).toBe(6000);
  });
  it('draws nothing once the play head has passed it, or without a read', () => {
    expect(bufferedEnd({ at: 100, ahead: 5 }, 200, 6000)).toBeNull();
    expect(bufferedEnd(null, 100, 6000)).toBeNull();
    expect(bufferedEnd({ at: 100, ahead: 5 }, null, 6000)).toBeNull();
    expect(bufferedEnd({ at: 100, ahead: 5 }, 100, null)).toBeNull();
  });
});
