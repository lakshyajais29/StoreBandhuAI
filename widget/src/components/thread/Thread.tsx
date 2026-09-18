import { useEffect, useRef } from 'react';
import type { Api } from '../../api';
import type { AssetMap, ChatMessage, UiCard } from '../../types';
import { cardKey, type CardContext } from '../cards';
import { MessageRow } from './MessageRow';
import { Icon } from '../ui/Icon';

type Props = {
  messages: ChatMessage[];
  assets: AssetMap;
  api: Api;
  busy: boolean;
  loading: boolean;
  loadError: string | null;
  sendError: string | null;
  archived: boolean;
  starters: string[];
  storeName: string;
  onRetryLoad: () => void;
  onRestore: () => void;
  onStarter: (s: string) => void;
  onConfirm: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onJobSettled: () => void;
  onTopUp: () => void;
};

const cardsOf = (m: ChatMessage): UiCard[] => (Array.isArray(m.ui) ? m.ui : m.ui ? [m.ui] : []);

export function Thread(p: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [p.messages.length, p.busy]);

  if (p.loading) {
    return (
      <div className="thread" aria-busy="true">
        <div className="th-skeletons">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`skeleton-msg ${i % 2 ? 'is-user' : ''}`}>
              <span className="skeleton skeleton--line" /><span className="skeleton skeleton--line short" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (p.loadError) {
    return (
      <div className="thread">
        <div className="thread-inner">
          <div className="notice notice--error" role="alert">
            <p>{p.loadError}</p>
            <button type="button" className="btn-quiet" onClick={p.onRetryLoad}><Icon name="refresh" size={14} /> Try again</button>
          </div>
        </div>
      </div>
    );
  }

  // A job or action appears once inline and again as a system_event when it settles.
  // Render only its latest occurrence so the card updates in place rather than stacking.
  const latest = new Map<string, string>();
  for (const m of p.messages) for (const c of cardsOf(m)) { const k = cardKey(c); if (k) latest.set(k, m.id); }

  const ctx: CardContext = { api: p.api, onConfirm: p.onConfirm, onCancel: p.onCancel, onJobSettled: p.onJobSettled, onTopUp: p.onTopUp };

  return (
    <div className="thread" aria-live="polite">
      <div className="thread-inner">
        {p.archived && (
          <div className="banner" role="status">
            <p>This chat is archived. Restore it to keep talking — nothing was deleted.</p>
            <button type="button" className="btn-quiet" onClick={p.onRestore}><Icon name="refresh" size={14} /> Restore</button>
          </div>
        )}

        {p.messages.length === 0 && !p.busy && !p.archived && (
          <div className="empty">
            <span className="empty-mark" aria-hidden="true">ब</span>
            <h2>What should we do in {p.storeName}?</h2>
            <p>Check sales, update stock, create listings or make product photos — in English, Hindi or Hinglish.</p>
            <div className="starters">
              {p.starters.map((s) => (
                <button type="button" key={s} onClick={() => p.onStarter(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {p.messages.length === 0 && p.archived && <p className="sb-empty">This chat has no messages.</p>}

        {p.messages.map((m) => {
          const visible = cardsOf(m).filter((c) => { const k = cardKey(c); return !k || latest.get(k) === m.id; });
          return <MessageRow key={m.id} message={m} visibleCards={visible} assets={p.assets} ctx={ctx} />;
        })}

        {p.busy && (
          <article className="msg msg--assistant">
            <span className="msg-mark" aria-hidden="true">ब</span>
            <div className="msg-body">
              <div className="bubble thinking" aria-label="Bandhu is working">
                <i /><i /><i />
              </div>
            </div>
          </article>
        )}

        {p.sendError && <p className="notice notice--error" role="alert">{p.sendError}</p>}
        <div ref={endRef} />
      </div>
    </div>
  );
}
