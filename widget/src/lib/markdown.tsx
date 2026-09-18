import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, dependency-free formatter for assistant text.
 * Renders to React elements only (no dangerouslySetInnerHTML) — the LLM's output is
 * untrusted text, so nothing here ever touches innerHTML. Supports the handful of
 * things the system prompt encourages the model to use: **bold**, `code`, fenced
 * ```code blocks```, bullet/numbered lists, and bare URLs as links.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // bold, inline code, and bare URLs — in one pass, left to right, non-overlapping.
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|((https?:\/\/[^\s<>()]+))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${keyPrefix}-b${i}`}>{m[2]}</strong>);
    else if (m[3]) out.push(<code key={`${keyPrefix}-c${i}`}>{m[4]}</code>);
    else if (m[5]) {
      out.push(
        <a key={`${keyPrefix}-l${i}`} href={m[5]} target="_blank" rel="noreferrer noopener">
          {m[5]}
        </a>,
      );
    }
    last = re.lastIndex;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { type: 'p'; text: string }
  | { type: 'code'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] };

function toBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i += 1; }
      i += 1; // closing fence
      blocks.push({ type: 'code', text: buf.join('\n') });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i += 1; }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i += 1; }
      blocks.push({ type: 'ol', items });
      continue;
    }

    if (line.trim() === '') { i += 1; continue; }

    const buf: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !lines[i].trim().startsWith('```')) {
      buf.push(lines[i]); i += 1;
    }
    blocks.push({ type: 'p', text: buf.join('\n') });
  }
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  const blocks = toBlocks(text);
  return (
    <>
      {blocks.map((b, bi) => {
        const key = `b${bi}`;
        if (b.type === 'code') return <pre key={key} className="md-code"><code>{b.text}</code></pre>;
        if (b.type === 'ul') {
          return (
            <ul key={key} className="md-list">
              {b.items.map((it, ii) => <li key={ii}>{renderInline(it, `${key}-${ii}`)}</li>)}
            </ul>
          );
        }
        if (b.type === 'ol') {
          return (
            <ol key={key} className="md-list">
              {b.items.map((it, ii) => <li key={ii}>{renderInline(it, `${key}-${ii}`)}</li>)}
            </ol>
          );
        }
        return (
          <p key={key} className="md-p">
            {b.text.split('\n').map((line, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {renderInline(line, `${key}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
