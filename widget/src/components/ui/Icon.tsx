type Props = { name: keyof typeof PATHS; size?: number; className?: string };

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v10M9.5 9.5h5M9.5 14.5h5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  pencil: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z',
  archive: 'M3 7h18v3H3zM5 10v10h14V10M10 14h4',
  more: 'M12 6.5h.01M12 12h.01M12 17.5h.01',
  send: 'M5 12h14M13 6l6 6-6 6',
  clip: 'M16.5 6.5 8 15a2.1 2.1 0 0 0 3 3l8.5-8.5a4.2 4.2 0 0 0-6-6L5 12a6.4 6.4 0 0 0 9 9l6.5-6.5',
  chevron: 'M9 6l6 6-6 6',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  check: 'M5 13l4 4L19 7',
  dot: 'M12 12h.01',
} as const;

export function Icon({ name, size = 18, className }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
