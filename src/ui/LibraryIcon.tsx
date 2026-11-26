import type { ReactNode } from 'react';
export type LibraryIconName = 'folder' | 'game' | 'music' | 'tv' | 'movie' | 'search' | 'settings' | 'menu' | 'left' | 'close' | 'filter' | 'grid' | 'queue' | 'sort';
const paths: Record<LibraryIconName, ReactNode> = {
  folder: <path d="M3 7h6l2-3h4l2 3h4v13H3z" />,
  game: <><path d="M7 7h10c3 0 5 10 3 12-1 1-3-2-5-3H9c-2 1-4 4-5 3-2-2 0-12 3-12z" /><path d="M8 10v5m-2-2h4" /><circle cx="16" cy="11" r=".6" /><circle cx="18" cy="14" r=".6" /></>,
  music: <><path d="M9 18V5l11-2v13M9 8l11-2" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  tv: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  movie: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4m10 0h4M3 16h4m10 0h4" /></>,
  search: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></>,
  settings: <><path d="m9 3 1-2h4l1 2 3 2 2 1 2 4-2 2v3l1 2-3 3-2-1-3 1-2 2-4-1-1-3-2-2-2-1V9l2-1 2-3z" /><circle cx="12" cy="12" r="3" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  left: <path d="m15 4-8 8 8 8" />,
  close: <path d="m5 5 14 14M19 5 5 19" />,
  filter: <path d="M3 4h18l-7 8v7l-4 2V12z" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  queue: <><path d="M4 5h16M4 11h16M4 17h8" /><path d="m16 15 5 3-5 3z" /></>,
  sort: <path d="M7 3v18m-4-4 4 4 4-4M17 21V3m-4 4 4-4 4 4" />,
};
export default function LibraryIcon({ name }: { name: LibraryIconName }) {
  return <svg className="library-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
