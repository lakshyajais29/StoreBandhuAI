import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import css from './styles.css?inline';
import type { MountOptions } from './types';

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Embeds the assistant inside a Shadow DOM so dashboard CSS and widget CSS never collide. */
export function mount(opts: MountOptions) {
  if (!opts?.apiBaseUrl || typeof opts.getToken !== 'function') throw new Error('BandhuAI.mount needs apiBaseUrl and getToken');
  unmount();
  const workspace = opts.mode === 'workspace';
  const target = opts.target || document.body;

  host = document.createElement('div');
  host.id = 'bandhu-ai-widget';
  if (workspace) {
    // Fill the given container, or the viewport when mounted straight onto <body>.
    host.style.cssText = target === document.body
      ? 'position:fixed;inset:0;z-index:2147483000;'
      : 'display:block;position:relative;width:100%;height:100%;';
  }
  target.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=Mukta:wght@400;500;600;700&display=swap';
  document.head.appendChild(fonts); // @font-face must be registered on the document to be usable inside the shadow root
  const style = document.createElement('style');
  style.textContent = css;
  const container = document.createElement('div');
  if (workspace) container.style.cssText = 'position:absolute;inset:0;';
  shadow.append(style, container);
  root = createRoot(container);
  root.render(<App opts={opts} />);
}

export function unmount() {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
}
