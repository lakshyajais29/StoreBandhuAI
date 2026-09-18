import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApi } from './api';
import type { ConversationSummary, MountOptions, ThemeChoice, Wallet } from './types';
import { loadTheme, resolveTheme, saveTheme, watchSystemTheme } from './theme';
import { useConversations } from './state/useConversations';
import { useThread } from './state/useThread';
import { useFocusTrap } from './lib/useFocusTrap';
import { Sidebar } from './components/shell/Sidebar';
import { Header } from './components/shell/Header';
import { Thread } from './components/thread/Thread';
import { Composer } from './components/Composer';
import { AccountPanel } from './components/account/AccountPanel';
import { Icon } from './components/ui/Icon';

const STARTERS = ['Aaj kitna becha?', 'Stock of blue shirt', 'Blue shirt ka white background photo', 'Mere tokens kitne hain?'];

export function App({ opts }: { opts: MountOptions }) {
  const api = useMemo(() => createApi(opts.apiBaseUrl, opts.getToken), [opts.apiBaseUrl, opts.getToken]);
  const workspace = opts.mode === 'workspace';

  const [open, setOpen] = useState(workspace || !!opts.startOpen);
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);
  const [drawer, setDrawer] = useState(false);
  const [account, setAccount] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const drawerRef = useFocusTrap<HTMLDivElement>(drawer, () => setDrawer(false));

  const mode = resolveTheme(theme);
  useEffect(() => watchSystemTheme(() => theme === 'system' && setTheme('system')), [theme]);
  const applyTheme = (t: ThemeChoice) => { setTheme(t); saveTheme(t); };

  // Escape minimises the floating panel when nothing else is capturing it (workspace mode has no minimise).
  useEffect(() => {
    if (!open || workspace || drawer || account) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, workspace, drawer, account]);

  const list = useConversations(api);

  const onConversationTouched = useCallback((c: ConversationSummary) => {
    if (list.view === 'active') list.upsert(c);
    // Reconcile the provisional title (and ordering) against the server.
    setTimeout(() => list.reload(), 400);
  }, [list]);

  const thread = useThread(api, { onWallet: setWallet, onConversationTouched });

  const loadWallet = useCallback(() => { api.wallet().then(setWallet).catch(() => {}); }, [api]);
  useEffect(() => { if (open) loadWallet(); }, [open, loadWallet]);

  const newChat = () => { thread.reset(); setDrawer(false); };
  const openConversation = (id: string) => { thread.open(id); setDrawer(false); };

  const rename = async (id: string, title: string) => {
    await list.rename(id, title);
    if (id === thread.activeId) thread.setTitle(title);
  };

  const setStatus = async (id: string, status: 'active' | 'archived') => {
    await list.setStatus(id, status);
    if (id !== thread.activeId) return;
    if (status === 'archived') thread.reset(); else thread.markRestored();
  };

  const restoreActive = async () => {
    if (!thread.activeId) return;
    await list.setStatus(thread.activeId, 'active');
    thread.markRestored();
    list.reload();
  };

  const archived = thread.meta?.status === 'archived';
  const title = thread.meta?.title || (thread.activeId ? 'Loading…' : 'New chat');

  const sidebar = (
    <Sidebar
      conversations={list.items} activeId={thread.activeId} view={list.view}
      loading={list.loading} loadingMore={list.loadingMore} error={list.error} hasMore={list.hasMore}
      wallet={wallet} theme={theme}
      onView={list.setView} onReload={list.reload} onLoadMore={list.loadMore}
      onNew={newChat} onOpen={openConversation} onRename={rename} onSetStatus={setStatus}
      onTheme={applyTheme} onAccount={() => { setAccount(true); setDrawer(false); }}
      onCloseDrawer={workspace ? undefined : () => setDrawer(false)}
    />
  );

  if (!open) {
    return (
      <div className="bandhu-root bandhu-root--panel" data-theme={mode}>
        <button type="button" className="launcher" onClick={() => setOpen(true)} aria-label="Open Bandhu AI">
          <span className="brand-mark" aria-hidden="true">ब</span> Ask Bandhu
        </button>
      </div>
    );
  }

  return (
    <div className={`bandhu-root ${workspace ? 'bandhu-root--workspace' : 'bandhu-root--panel'}`} data-theme={mode}>
      <section className="shell" role={workspace ? undefined : 'dialog'} aria-label="Bandhu AI assistant">
        <aside className="shell-side">{sidebar}</aside>

        {drawer && (
          <div className="drawer">
            <button type="button" className="drawer-scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />
            <div className="drawer-panel" ref={drawerRef} tabIndex={-1}>{sidebar}</div>
          </div>
        )}

        <main className="shell-main">
          <Header
            title={title} archived={archived} wallet={wallet} showMenu
            onMenu={() => setDrawer(true)} onAccount={() => setAccount(true)}
            onClose={workspace ? undefined : () => setOpen(false)}
          />
          <Thread
            messages={thread.messages} assets={thread.assets} api={api}
            busy={thread.busy} loading={thread.loading}
            loadError={thread.loadError} sendError={thread.sendError}
            archived={archived} starters={STARTERS} storeName="your store"
            onRetryLoad={thread.retry} onRestore={restoreActive}
            onStarter={(s) => thread.send(s, [])}
            onConfirm={thread.confirm} onCancel={thread.cancel}
            onJobSettled={() => { thread.refresh(); loadWallet(); }}
            onTopUp={() => setAccount(true)}
          />
          <Composer
            disabled={thread.busy || thread.loading || archived}
            lockedReason={archived ? 'Restore this chat to keep talking.' : undefined}
            onSend={thread.send}
          />
        </main>

        {!workspace && (
          <button type="button" className="shell-min" onClick={() => setOpen(false)} aria-label="Minimise assistant">
            <Icon name="chevron" size={16} />
          </button>
        )}

        {account && (
          <AccountPanel api={api} wallet={wallet} theme={theme} onTheme={applyTheme} onWallet={setWallet} onClose={() => setAccount(false)} />
        )}
      </section>
    </div>
  );
}
