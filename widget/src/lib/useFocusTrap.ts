import { useEffect, useRef } from 'react';

const SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab focus inside the given element while `active`, restores focus to whatever
 * had it on open, and calls `onEscape` on the Escape key. Used for the mobile drawer
 * and the account sheet — the two overlays in this app that sit above the thread.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () => (root ? Array.from(root.querySelectorAll<HTMLElement>(SELECTOR)) : []);
    const first = focusables()[0];
    (first || root)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(); return; }
      if (e.key !== 'Tab' || !root) return;
      const items = focusables();
      if (items.length === 0) return;
      const [firstEl, lastEl] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };

    root?.addEventListener('keydown', onKeyDown);
    return () => {
      root?.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [active, onEscape]);

  return ref;
}
