import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import FocusButton from './FocusButton';
import FocusGroup, { FocusProvider } from './FocusGroup';
import { useNavGroup } from './focusGroups';
import { focusTo, returnFocusTo } from './focus';
import { useUiMode } from './tv';
import { useOutsideDismiss } from './useOutsideDismiss';
import LibraryIcon, { type LibraryIconName } from './LibraryIcon';
import './collectionLayout.css';
export interface CollectionItem { id: number; name: string; count: number }
interface Props {
  scope: 'music' | 'movies' | 'tv' | 'games'; items: CollectionItem[]; selected: number;
  onSelect: (id: number) => void; onManage: () => void; mainFocus: string;
  children: (toggle: ReactNode) => ReactNode;
}
export default function CollectionLayout({ scope, items, selected, onSelect, onManage, mainFocus, children }: Props) {
  const mode = useUiMode();
  const [navHeight, setNavHeight] = useState(() => document.querySelector('.top-nav')?.getBoundingClientRect().height ?? 0);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1000px)').matches);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('kinema.sidebar.collapsed') === 'yes');
  const [drawer, setDrawer] = useState(false);
  const compact = mode === 'handheld' || narrow, expanded = compact ? drawer : !collapsed;
  const toggleKey = 'library-collections-toggle-' + scope;
  const { ref, focusKey } = useNavGroup({ kind: 'row', panes: true }, { focusKey: 'library-layout-' + scope });
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1000px)');
    const update = () => setNarrow(media.matches);
    media.addEventListener('change',update); return () => media.removeEventListener('change',update);
  }, []);
  useEffect(() => {
    const nav = document.querySelector('.top-nav');
    if (!nav) return;
    const observer = new ResizeObserver(() => setNavHeight(nav.getBoundingClientRect().height));
    observer.observe(nav); return () => observer.disconnect();
  }, []);
  const close = () => {
    if (compact) setDrawer(false); else { setCollapsed(true); localStorage.setItem('kinema.sidebar.collapsed','yes'); }
    returnFocusTo(toggleKey);
  };
  useOutsideDismiss(compact && drawer, '.collection-sidebar, .library-sidebar-toggle', close);
  useEffect(() => {
    if (!compact || !drawer) return;
    const back = (event: KeyboardEvent) => {
      if (['Escape','Backspace','BrowserBack'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); setDrawer(false); returnFocusTo(toggleKey); }
    };
    window.addEventListener('keydown',back,true); return () => window.removeEventListener('keydown',back,true);
  }, [compact, drawer, toggleKey]);
  const icon: LibraryIconName = scope === 'music' ? 'music' : scope === 'movies' ? 'movie' : scope === 'games' ? 'game' : 'tv';
  const toggle = expanded && !compact ? null : <FocusButton focusKey={toggleKey} className="library-icon-button library-sidebar-toggle" label="Collections" expanded={expanded} controls={'collection-sidebar-' + scope} onSelect={() => {
    if (compact) { setDrawer(!drawer); if (!drawer) requestAnimationFrame(() => focusTo('collection-' + scope + '-' + selected)); }
    else { setCollapsed(false); localStorage.setItem('kinema.sidebar.collapsed','no'); }
  }}><LibraryIcon name="menu" /></FocusButton>;
  return <FocusProvider value={focusKey}><div ref={ref} style={navHeight ? { '--library-top': `${navHeight}px` } as CSSProperties : undefined} className={'library-shell' + (expanded ? ' sidebar-expanded' : '') + (compact ? ' sidebar-compact' : '')}>
    {compact && drawer && <div className="library-sidebar-backdrop" aria-hidden="true" />}
    {expanded && <aside id={'collection-sidebar-' + scope} className="collection-sidebar" role={compact ? 'dialog' : undefined} aria-modal={compact ? true : undefined} aria-label={scope === 'music' ? 'Music collections' : scope === 'movies' ? 'Movie collections' : scope === 'games' ? 'Game & app collections' : 'TV collections'}>
      <FocusGroup kind={compact ? 'menu' : 'list'} current={'collection-' + scope + '-' + selected} focusKey={'library-sidebar-' + scope} className="collection-sidebar-body">
        <FocusGroup kind="row" className="collection-sidebar-heading"><h2>Collections</h2><FocusButton className="library-icon-button" label={compact ? 'Close collections' : 'Collapse collections'} onSelect={close}><LibraryIcon name={compact ? 'close' : 'left'} /></FocusButton></FocusGroup>
        {items.map((item) => <FocusButton key={item.id} focusKey={'collection-' + scope + '-' + item.id} className={'collection-sidebar-item' + (item.id === selected ? ' selected' : '')} pressed={item.id === selected} label={item.name + ' (' + item.count + ')'} title={item.count.toLocaleString() + (scope === 'music' ? ' tracks' : scope === 'tv' ? ' shows' : scope === 'games' ? ' shortcuts' : ' movies')} onSelect={() => {
          onSelect(item.id);
          if (compact) { setDrawer(false); requestAnimationFrame(() => focusTo(mainFocus)); }
        }}><LibraryIcon name={item.id === 0 ? 'folder' : icon} /><span className="collection-sidebar-name">{item.name}</span><span className="collection-sidebar-count">{item.count.toLocaleString()}</span></FocusButton>)}
        <FocusButton focusKey={'library-manage-' + scope} className="collection-manage" onSelect={() => { if (compact) setDrawer(false); onManage(); }}><LibraryIcon name="settings" /><span>Manage collections</span></FocusButton>
      </FocusGroup>
    </aside>}
    <FocusGroup kind="list" current={mainFocus} className="library-main">{children(toggle)}</FocusGroup>
  </div></FocusProvider>;
}
