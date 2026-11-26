import { expect, it } from 'vitest';
import { musicSearchText, musicText } from './language';
it('finds Japanese metadata with kana and full-width variations', () => {
  expect(musicSearchText('ｶﾀｶﾅ')).toBe(musicSearchText('カタカナ'));
  expect(musicSearchText('カタカナ')).toBe(musicSearchText('かたかな'));
  expect(musicSearchText('Ｊ－ＰＯＰ')).toBe(musicSearchText('j-pop'));
  expect(musicSearchText('宇多田ヒカル')).toContain('宇多田');
});
it('provides readable Japanese labels without changing metadata', () => {
  expect(musicText('ja', 'next')).toBe('次の曲');
  expect(musicText('ja', 'addSong', { title: '夜に駆ける' })).toBe('「夜に駆ける」をキューに追加');
});
