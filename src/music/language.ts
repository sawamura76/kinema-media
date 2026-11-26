import { useSyncExternalStore } from 'react';

const en = {
  collectionsLabel: 'Collections', collectionLabel: 'Collection', addCollection: 'Add collection',
  collectionAddMusic: 'Add music', collectionName: 'Collection name', collectionCreate: 'Create',
  collectionFolder: 'Choose the music folder for this collection',
  tagPreview: 'Preview match',
  tagCurrent: 'Current tags and filename',
  tagReviewPairs: 'Check each track pairing before using this match. Save writes the tags.',
  tagUseMatch: 'Use this match',

  tagEdit: "Edit Tags",
  tagMatch: "Auto Music Match",
  tagManual: "Manual Match",
  tagMatching: "Searching MusicBrainz…",
  tagNoMatch: "No reliable match. Try Manual Match or edit the tags here.",
  tagMatchFound: "Matched {artist} · {album}. Review the tags, then Save.",
  tagScope: "Album fields apply to all {n} selected MP3s. Edit song titles and track numbers individually.",
  tagIncludeFolder: "Include all {n} MP3s in these folders",
  tagAlbum: "Album",
  tagAlbumArtist: "Album artist",
  tagTrackArtist: "Track artist",
  tagTitle: "Song title",
  tagYear: "Year",
  tagGenre: "Genre",
  tagNumber: "Track number",
  tagDisc: "Disc number",
  tagMixed: "Mixed values",
  tagCover: "Album cover",
  tagChooseCover: "Choose cover…",
  tagImages: "Cover images",
  tagUndoCover: "Discard cover change",
  tagMatchedCover: "Embed in tracks without artwork on Save.",
  tagReplaceCover: "Embed this cover in all selected MP3s on Save.",
  tagShowTracks: "Edit individual tracks",
  tagHideTracks: "Hide individual tracks",
  tagCancel: "Cancel",
  tagSave: "Save",
  tagSaving: "Writing MP3 tags…",
  tagSaved: "MP3 tags saved.",
  tagSavedWarning: "MP3 tags saved. Library scan reported: {warning}",
  tagSearch: "Search",
  tagNoResults: "No releases found. Try changing the album or artist.",
  tagReleaseMismatch: "This release could not be aligned with the selected tracks. Choose the edition with the same tracks or edit the tags directly.",
  albumTracks: '{n} tracks', back: '← Back', tracks: 'Tracks', biographyUnavailable: 'No biography available yet.', readMore: 'Read more', readLess: 'Show less', albumDuration: '{minutes} min {seconds} sec',
  rotatePresets: 'Rotate every {seconds} seconds', holdPreset: 'Keep this preset',
  radial: 'Radial spectrum', led: 'Retro LED', spectrum: 'Color spectrum', spectrumStarting: 'Starting spectrum analyzer…', spectrumUnavailable: 'Audio capture unavailable — showing artwork. Switch background to retry.', plain: 'Plain image', blurred: 'Blurred image', butterchurn: 'Butterchurn', nextPreset: 'Next preset', butterchurnStarting: 'Starting Butterchurn…', butterchurnUnavailable: 'Butterchurn unavailable — showing artwork. Switch background to retry.', reducedMotion: 'Reduced motion enabled — showing artwork', artistBackground: 'Artist background', albumBackground: 'Album background', artSource: 'Artist artwork: TheAudioDB', refreshArt: 'Refresh artist art', artOffline: 'Artist artwork unavailable — using album art', artFallback: 'Album art fallback · Artist artwork: TheAudioDB',
  music: 'Music', collection: 'YOUR LOCAL COLLECTION', Albums: 'Albums', Artists: 'Artists', Songs: 'Songs', Queue: 'Queue', Folders: 'Folders',
  add: 'Add music folder', rescan: 'Rescan', scanning: 'Reading music tags and artwork…', scanBusy: 'Scanning…', choose: 'Choose your music folder',
  search: 'Search music', searchHint: 'Artist, album or song', play: 'Play', shuffle: 'Shuffle', addQueue: '+ Queue', remove: 'Remove',
  allAlbums: '← All albums', allArtists: '← All artists', album: 'ALBUM', folders: 'Music folders',
  removeFolder: 'Remove from library', removeHint: 'Removing a folder only removes its music from this library.',
  emptyTitle: 'Your music, all here.', empty: 'Add music folders in Settings → Library → Music folders. Tags and artwork are read from your files. Your files stay untouched.',
  noSongs: 'No readable music found yet. Choose Rescan after adding audio files.', emptyQueue: 'Add songs with the + Queue button.', shuffleQueue: 'Shuffle queue',
  repeat: 'Repeat', off: 'Off', all: 'All', one: 'One', previous: 'Previous song', next: 'Next song', pause: 'Pause music', resume: 'Play music', stop: 'Stop music',
  position: 'Song position', volume: 'Volume', nowPlaying: 'Now playing music', addSong: 'Add {title} to queue', removeSong: 'Remove {title} from queue',
  summary: '{songs} songs · {albums} albums · {artists} artists', artistAlbums: '{n} albums', albumSongs: '{n} songs',
  scanned: '{added} added · {updated} updated · {unchanged} unchanged', scanErrors: '{n} files or folders could not be read.', missing: '{n} missing',
  openNowPlaying: 'Open full-screen music', exitNowPlaying: 'Exit full-screen music', artist: 'Artist', track: 'Track', visualizer: 'Background',
};
const ja: Record<keyof typeof en, string> = {
  collectionsLabel: 'コレクション', collectionLabel: 'コレクション', addCollection: 'コレクションを追加',
  collectionAddMusic: '音楽を追加', collectionName: 'コレクション名', collectionCreate: '作成',
  collectionFolder: 'コレクションの音楽フォルダーを選択',
  tagPreview: '照合をプレビュー',
  tagCurrent: '現在のタグとファイル名',
  tagReviewPairs: '各曲の組み合わせを確認してください。タグは保存時に書き込まれます。',
  tagUseMatch: 'この照合を使う',

  tagEdit: "タグを編集",
  tagMatch: "音楽を自動照合",
  tagManual: "手動で照合",
  tagMatching: "MusicBrainzを検索中…",
  tagNoMatch: "一致するアルバムがありません。手動照合またはタグ編集をお試しください。",
  tagMatchFound: "{artist} · {album} に一致しました。タグを確認して保存してください。",
  tagScope: "アルバム項目は選択したMP3 {n}曲に適用されます。曲名と曲番号は個別に編集できます。",
  tagIncludeFolder: "フォルダー内のMP3 {n}曲をすべて含める",
  tagAlbum: "アルバム",
  tagAlbumArtist: "アルバムアーティスト",
  tagTrackArtist: "曲のアーティスト",
  tagTitle: "曲名",
  tagYear: "年",
  tagGenre: "ジャンル",
  tagNumber: "曲番号",
  tagDisc: "ディスク番号",
  tagMixed: "複数の値",
  tagCover: "カバー画像",
  tagChooseCover: "カバー画像を選択…",
  tagImages: "カバー画像",
  tagUndoCover: "画像の変更を取り消す",
  tagMatchedCover: "保存時に画像のない曲に埋め込みます。",
  tagReplaceCover: "保存時に選択したMP3すべてに画像を埋め込みます。",
  tagShowTracks: "曲ごとに編集",
  tagHideTracks: "曲の編集を閉じる",
  tagCancel: "キャンセル",
  tagSave: "保存",
  tagSaving: "MP3タグを保存中…",
  tagSaved: "MP3タグを保存しました。",
  tagSavedWarning: "MP3タグを保存しました。スキャン結果: {warning}",
  tagSearch: "検索",
  tagNoResults: "リリースが見つかりません。アルバム名かアーティスト名を変更してください。",
  tagReleaseMismatch: "選択した曲と一致しません。同じ曲を含む版を選ぶか、タグを編集してください。",
  albumTracks: '{n}曲', back: '← 戻る', tracks: '曲一覧', biographyUnavailable: 'アーティスト紹介はまだありません。', readMore: '続きを読む', readLess: '閉じる', albumDuration: '{minutes}分{seconds}秒',
  rotatePresets: '{seconds}秒ごとに切り替え', holdPreset: 'このプリセットを固定',
  radial: '円形スペクトラム', led: 'レトロLED', spectrum: 'カラースペクトラム', spectrumStarting: 'スペクトラムを起動中…', spectrumUnavailable: '音声を取得できません — 画像を表示します。背景を切り替えると再試行します。', plain: '通常の画像', blurred: 'ぼかした画像', butterchurn: 'Butterchurn', nextPreset: '次のプリセット', butterchurnStarting: 'Butterchurnを起動中…', butterchurnUnavailable: 'Butterchurnを利用できません — 画像を表示します。背景を切り替えると再試行します。', reducedMotion: '視覚効果を減らす設定 — 画像を表示', artistBackground: 'アーティストの背景', albumBackground: 'アルバムの背景', artSource: 'アーティスト画像: TheAudioDB', refreshArt: 'アーティスト画像を更新', artOffline: 'アーティスト画像を取得できません — アルバム画像を表示', artFallback: 'アルバム画像を表示 · 画像提供: TheAudioDB',
  music: '音楽', collection: 'ローカル音楽ライブラリ', Albums: 'アルバム', Artists: 'アーティスト', Songs: '曲', Queue: '再生キュー', Folders: 'フォルダー',
  add: '音楽フォルダーを追加', rescan: '再スキャン', scanning: '音楽のタグとアートワークを読み込み中…', scanBusy: 'スキャン中…', choose: '音楽フォルダーを選択',
  search: '音楽を検索', searchHint: 'アーティスト・アルバム・曲名', play: '再生', shuffle: 'シャッフル', addQueue: 'キューに追加', remove: '削除',
  allAlbums: '← すべてのアルバム', allArtists: '← すべてのアーティスト', album: 'アルバム', folders: '音楽フォルダー',
  removeFolder: 'ライブラリから削除', removeHint: 'フォルダーを削除しても、音楽ファイルは削除されません。',
  emptyTitle: 'あなたの音楽を、ここに。', empty: '音楽フォルダーを追加すると、アルバム・アーティスト・曲を表示できます。タグとアートワークを読み込みます。元のファイルは変更しません。',
  noSongs: '音楽がまだ見つかりません。設定のライブラリから音楽フォルダーを追加してスキャンしてください。', emptyQueue: '「キューに追加」で曲を追加できます。', shuffleQueue: 'キューをシャッフル',
  repeat: 'リピート', off: 'オフ', all: 'すべて', one: '1曲', previous: '前の曲', next: '次の曲', pause: '一時停止', resume: '再生', stop: '音楽を停止',
  position: '曲の再生位置', volume: '音量', nowPlaying: '再生中の音楽', addSong: '「{title}」をキューに追加', removeSong: '「{title}」をキューから削除',
  summary: '{songs}曲 · {albums}アルバム · {artists}アーティスト', artistAlbums: '{n}アルバム', albumSongs: '{n}曲',
  scanned: '追加 {added}曲 · 更新 {updated}曲 · 変更なし {unchanged}曲', scanErrors: '{n}個のファイルまたはフォルダーを読み込めませんでした。', missing: '{n}曲が見つかりません',
  openNowPlaying: '音楽を全画面表示', exitNowPlaying: '全画面表示を終了', artist: 'アーティスト', track: '曲名', visualizer: '背景',
};
export type MusicLanguage = 'en' | 'ja';
export function musicText(language: MusicLanguage, key: keyof typeof en, values: Record<string, string | number> = {}) {
  return (language === 'ja' ? ja : en)[key].replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
const listeners = new Set<() => void>();
function language(): MusicLanguage {
  try { const saved = localStorage.getItem('kinema.music.language'); if (saved === 'en' || saved === 'ja') return saved; } catch { /* Private storage can be unavailable. */ }
  return navigator.language?.startsWith('ja') ? 'ja' : 'en';
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function useMusicLanguage() {
  const value = useSyncExternalStore(subscribe, language);
  return { language: value, t: (key: keyof typeof en, values?: Record<string, string | number>) => musicText(value, key, values), toggle: () => { localStorage.setItem('kinema.music.language', value === 'en' ? 'ja' : 'en'); listeners.forEach((fn) => fn()); } };
}

/** NFKC handles half-width kana/full-width Latin; map katakana to hiragana for searching. */
export function musicSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}



