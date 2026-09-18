import { useMemo, useState } from 'react';
import type { ConversationSummary, ThemeChoice, Wallet } from '../../types';
import type { ConversationView } from '../../state/useConversations';
import { Icon } from '../ui/Icon';

type Props = {
  conversations: ConversationSummary[];
  activeId?: string;
  view: ConversationView;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  wallet: Wallet | null;
  theme: ThemeChoice;
  onView: (v: ConversationView) => void;
  onReload: () => void;
  onLoadMore: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onSetStatus: (id: string, status: 'active' | 'archived') => Promise<void>;
  onTheme: (t: ThemeChoice) => void;
  onAccount: () => void;
  onCloseDrawer?: () => void;
};

const DAY = 86_400_000;

function bucketOf(iso: string): string {
  const age = Date.now() - new Date(iso).getTime();
  if (age < DAY) return 'Today';
  if (age < 7 * DAY) return 'Previous 7 days';
  if (age < 30 * DAY) return 'Previous 30 days';
  return 'Older';
}

export function Sidebar(p: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const archivedView = p.view === 'archived';

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? p.conversations.filter((c) => c.title.toLowerCase().includes(q)) : p.conversations;
    const out: { label: string; items: ConversationSummary[] }[] = [];
    for (const c of rows) {
      const label = bucketOf(c.lastMessageAt);
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(c); else out.push({ label, items: [c] });
    }
    return out;
  }, [p.conversations, query]);

  const filtered = query.trim().length > 0;
  const nothingFound = filtered && groups.length === 0 && p.conversations.length > 0;

  const commitRename = async (id: string) => {
    const title = draft.trim();
    setEditing(null);
    if (title) await p.onRename(id, title).catch(() => {});
  };

  return (
    <nav className="sb" aria-label="Conversations">
      <div className="sb-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">ब</span>
          <span className="brand-name">Bandhu AI</span>
        </div>
        {p.onCloseDrawer && (
          <button type="button" className="icon-btn sb-drawer-close" onClick={p.onCloseDrawer} aria-label="Close menu">
            <Icon name="close" />
          </button>
        )}
      </div>

      <button type="button" className="btn-new" onClick={p.onNew}>
        <Icon name="plus" size={16} /> New chat
      </button>

      <div className="sb-tabs" role="tablist" aria-label="Conversation list">
        {(['active', 'archived'] as const).map((v) => (
          <button
            key={v} type="button" role="tab" aria-selected={p.view === v}
            className={p.view === v ? 'is-on' : ''} onClick={() => p.onView(v)}
          >
            {v === 'active' ? 'Chats' : 'Archived'}
          </button>
        ))}
      </div>

      <div className="sb-search">
        <Icon name="search" size={15} />
        <input
          type="search"
          value={query}
          placeholder={archivedView ? 'Search archived' : 'Search chats'}
          aria-label="Search conversations"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="sb-list">
        {p.loading && p.conversations.length === 0 && (
          <div className="sb-skeletons" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className="skeleton skeleton--row" />)}
          </div>
        )}

        {p.error && (
          <div className="sb-error" role="alert">
            <p>{p.error}</p>
            <button type="button" className="btn-quiet" onClick={p.onReload}><Icon name="refresh" size={14} /> Retry</button>
          </div>
        )}

        {!p.loading && !p.error && p.conversations.length === 0 && (
          <p className="sb-empty">
            {archivedView ? 'Nothing archived yet.' : 'No chats yet. Start one and it will appear here.'}
          </p>
        )}

        {nothingFound && <p className="sb-empty">No chats match “{query.trim()}”.</p>}

        {!p.error && groups.map((g) => (
          <section key={g.label} className="sb-group">
            <h3>{g.label}</h3>
            <ul>
              {g.items.map((c) => (
                <li key={c.id} className={`sb-item ${c.id === p.activeId ? 'is-active' : ''}`}>
                  {editing === c.id ? (
                    <input
                      className="sb-rename"
                      autoFocus
                      value={draft}
                      aria-label="Conversation name"
                      maxLength={80}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename(c.id); }
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <>
                      <button type="button" className="sb-item-open" onClick={() => p.onOpen(c.id)} title={c.title}>
                        <span>{c.title}</span>
                      </button>
                      <span className="sb-item-tools">
                        <button
                          type="button" className="icon-btn" aria-label={`Rename ${c.title}`}
                          onClick={() => { setEditing(c.id); setDraft(c.title); }}
                        >
                          <Icon name="pencil" size={15} />
                        </button>
                        <button
                          type="button" className="icon-btn"
                          aria-label={`${archivedView ? 'Restore' : 'Archive'} ${c.title}`}
                          title={archivedView ? 'Restore' : 'Archive'}
                          onClick={() => p.onSetStatus(c.id, archivedView ? 'active' : 'archived').catch(() => {})}
                        >
                          <Icon name={archivedView ? 'refresh' : 'archive'} size={15} />
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {p.hasMore && !p.error && !filtered && (
          <div className="sb-loadmore">
            <button type="button" className="btn-quiet" disabled={p.loadingMore} onClick={p.onLoadMore}>
              {p.loadingMore ? 'Loading…' : 'Load older chats'}
            </button>
          </div>
        )}
        {p.hasMore && filtered && (
          <p className="sb-empty">Search covers loaded chats. Load older chats to widen it.</p>
        )}
      </div>

      <footer className="sb-foot">
        <button type="button" className="sb-foot-row sb-tokens" onClick={p.onAccount}>
          <Icon name="coin" size={16} />
          <span>Tokens</span>
          <strong className={p.wallet && p.wallet.available < 10 ? 'is-low' : ''}>
            {p.wallet ? p.wallet.available : '—'}
          </strong>
        </button>

        <div className="sb-theme" role="group" aria-label="Theme">
          {(['light', 'system', 'dark'] as const).map((t) => (
            <button
              key={t} type="button" className={p.theme === t ? 'is-on' : ''}
              aria-pressed={p.theme === t} aria-label={`${t} theme`} onClick={() => p.onTheme(t)}
            >
              {t === 'light' ? <Icon name="sun" size={15} /> : t === 'dark' ? <Icon name="moon" size={15} /> : <span className="theme-auto">Auto</span>}
            </button>
          ))}
        </div>

        <button type="button" className="sb-foot-row" onClick={p.onAccount}>
          <Icon name="user" size={16} />
          <span>Account</span>
        </button>
      </footer>
    </nav>
  );
}
