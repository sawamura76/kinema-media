import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Entry } from './history';
import { useMouseNavigationEnabled } from './navigationPreferences';
import { currentFocusKey, returnFocusTo } from './focus';

/** Extra mouse buttons navigate app views, without invoking WebView history. */
export function useMouseNavigation<V>(stack: Entry<V>[], setStack: Dispatch<SetStateAction<Entry<V>[]>>) {
  const enabled = useMouseNavigationEnabled();
  const history = useRef({ current: stack, past: [] as Entry<V>[][], future: [] as Entry<V>[][], restoring: false });
  useEffect(() => {
    const h = history.current;
    if (h.current === stack) return;
    if (!h.restoring) { h.past.push(h.current); h.past = h.past.slice(-64); h.future = []; }
    h.current = stack; h.restoring = false;
  }, [stack]);
  useEffect(() => {
    let mouseAt = -1000;
    const move = (direction: 'back' | 'forward') => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const local = new CustomEvent('kinema-mouse-navigation', { detail: direction, cancelable: true });
      if (!window.dispatchEvent(local)) return;
      const h = history.current;
      const source = direction === 'back' ? h.past : h.future;
      const next = source.pop();
      if (!next) return;
      const current = h.current.map((entry, index) => index === h.current.length - 1 ? { ...entry, returnFocus: currentFocusKey(), scrollTop: document.querySelector('.browse')?.scrollTop } : entry);
      (direction === 'back' ? h.future : h.past).push(current);
      h.restoring = true; setStack(next);
      const last = next[next.length - 1];
      returnFocusTo(last.returnFocus, last.scrollTop);
    };
    const cancel = (event: MouseEvent) => { if (event.button === 3 || event.button === 4) { event.preventDefault(); event.stopPropagation(); } };
    const up = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      cancel(event); mouseAt = performance.now(); if (enabled) move(event.button === 3 ? 'back' : 'forward');
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'BrowserBack' && event.key !== 'BrowserForward') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (enabled && !event.repeat && performance.now() - mouseAt > 200) move(event.key === 'BrowserBack' ? 'back' : 'forward');
    };
    const branch = () => { history.current.future = []; };
    window.addEventListener('mousedown', cancel, true);
    window.addEventListener('mouseup', up, true);
    window.addEventListener('auxclick', cancel, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('kinema-local-navigation', branch);
    return () => {
      window.removeEventListener('mousedown', cancel, true); window.removeEventListener('mouseup', up, true);
      window.removeEventListener('auxclick', cancel, true); window.removeEventListener('keydown', key, true);
      window.removeEventListener('kinema-local-navigation', branch);
    };
  }, [setStack, enabled]);
}
