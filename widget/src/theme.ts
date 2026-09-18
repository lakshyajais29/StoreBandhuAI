import type { ThemeChoice } from './types';

const KEY = 'bandhu.theme';

export function loadTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* storage blocked — fall through */ }
  return 'system';
}

export function saveTheme(t: ThemeChoice) {
  try { localStorage.setItem(KEY, t); } catch { /* preference only; not data */ }
}

export function resolveTheme(t: ThemeChoice): 'light' | 'dark' {
  if (t !== 'system') return t;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Notifies when the OS preference changes, so 'system' stays live. */
export function watchSystemTheme(cb: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
