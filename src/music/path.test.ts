import { expect, it } from 'vitest';
import { sameMusicPath } from './path';
it('matches native Windows paths after mpv strips the extended-length prefix', () => {
  expect(sameMusicPath('C:/Music/杏里/曲.mp3', '\\\\?\\C:\\Music\\杏里\\曲.mp3')).toBe(true);
  expect(sameMusicPath('\\\\server\\music\\曲.flac', '\\\\?\\UNC\\server\\music\\曲.flac')).toBe(true);
  expect(sameMusicPath('C:/Music/one.mp3', '\\\\?\\C:\\Music\\two.mp3')).toBe(false);
});
