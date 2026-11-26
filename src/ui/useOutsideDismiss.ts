import { useEffect } from 'react';

/** Pointer dismissal leaves the clicked control free to perform its normal action. */
export function useOutsideDismiss(open: boolean, boundary: string, dismiss: () => void) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest(boundary)) dismiss();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open, boundary, dismiss]);
}
