/** Rust canonicalize adds Windows' extended-length prefix; mpv removes it. */
export function musicPathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/\/\?\/unc\//i, '//').replace(/^\/\/\?\//, '').toLowerCase();
}
export function sameMusicPath(open: string, wanted: string): boolean {
  return musicPathKey(open) === musicPathKey(wanted);
}
