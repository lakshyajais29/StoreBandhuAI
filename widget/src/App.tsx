import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createApi, ApiError } from './api';
import type { ChatMessage, MountOptions, UiCard, Wallet } from './types';
import { ActionCard } from './components/ActionCard';
import { JobCard } from './components/JobCard';
import { Composer } from './components/Composer';
import { TopUp } from './components/TopUp';

const STARTERS = ['Aaj kitna becha?', 'Stock of blue shirt', 'Mere tokens kitne hain?'];
const cardsOf = (m: ChatMessage): UiCard[] => (Array.isArray(m.ui) ? m.ui : m.ui ? [m.ui] : []);

export function App({ opts }: { opts: MountOptions }) {
  const api = useMemo(() => createApi(opts.apiBaseUrl, opts.getToken), [opts.apiBaseUrl, opts.getToken]);
  const [open, setOpen] = useState(!!opts.startOpen);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(() => sessionStorage.getItem('bandhu.conversation') || undefined);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!conversationId) return;
    try {
      const c = await api.conversation(conversationId);
      setMessages(c.messages);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { sessionStorage.removeItem('bandhu.conversation'); setConversationId(undefined); }
    }
    api.wallet().then(setWallet).catch(() => {});
  }, [api, conversationId]);

  useEffect(() => { if (open) { refresh(); api.wallet().then(setWallet).catch(() => {}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length, busy]);

  const send = async (text: string, files: File[]) => {
    setBusy(true); setError(null);
    const temp: ChatMessage = { id: `tmp-${Date.now()}`, role: 'user', content: text, ui: null, attachments: [], createdAt: new Date().toISOString(), localPreview: files.map((f) => URL.createObjectURL(f)) };
    setMessages((m) => [...m, temp]);
    try {
      const assetIds = await Promise.all(files.map((f) => api.upload(f)));
      const r = await api.chat(text, conversationId, assetIds);
      setConversationId(r.conversationId);
      sessionStorage.setItem('bandhu.conversation', r.conversationId);
      setMessages((m) => [...m.filter((x) => x.id !== temp.id), ...r.messages.map((x) => (x.role === 'user' ? { ...x, localPreview: temp.localPreview } : x))]);
      setWallet(r.wallet);
    } catch (e: any) {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setError(e.code === 'RATE_LIMITED' ? 'You are sending messages too quickly. Wait a moment and try again.' : e.message || 'Could not reach Bandhu.');
    } finally {
      setBusy(false);
    }
  };

  const decide = (kind: 'confirm' | 'cancel') => async (id: string) => {
    const r = await (kind === 'confirm' ? api.confirm(id) : api.cancel(id));
    setWallet(r.wallet);
    await refresh();
  };

  return (
    <div className="bandhu-root">
      {open && (
        <section className="panel" role="dialog" aria-label="Bandhu AI assistant">
          <header className="panel-head">
            <div className="brand"><span className="brand-mark" aria-hidden="true">ब</span><span>Bandhu</span></div>
            <button type="button" className={`tokens ${wallet && wallet.available < 10 ? 'tokens--low' : ''}`} onClick={() => setSheet(true)} aria-label="Tokens and top up">
              {wallet ? `${wallet.available} tokens` : '…'}
            </button>
            <button type="button" className="close" aria-label="Close assistant" onClick={() => setOpen(false)}>×</button>
          </header>

          <div className="thread" aria-live="polite">
            {messages.length === 0 && !busy && (
              <div className="empty">
                <p>Tell me what to do in your store — check sales, update stock, create listings or make product photos.</p>
                <div className="starters">{STARTERS.map((s) => <button type="button" key={s} onClick={() => send(s, [])}>{s}</button>)}</div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`msg msg--${m.role}`}>
                {m.localPreview?.length ? <div className="thumbs">{m.localPreview.map((u) => <img key={u} src={u} alt="Attached" />)}</div> : null}
                {m.content && <p className="bubble">{m.role === 'system_event' ? m.content.replace(/\s*\[action .*\]$/, '') : m.content}</p>}
                {cardsOf(m).map((c, i) => {
                  if (c.type === 'pending_action' || c.type === 'action_result') return <ActionCard key={i} action={c.action} onConfirm={decide('confirm')} onCancel={decide('cancel')} />;
                  if (c.type === 'job') return <JobCard key={c.job.id + c.job.status} job={c.job} api={api} onSettled={refresh} />;
                  if (c.type === 'insufficient_tokens') return <button type="button" key={i} className="inline-cta" onClick={() => setSheet(true)}>Add tokens{c.required ? ` (needs ${c.required})` : ''}</button>;
                  if (c.type === 'upgrade_required') return <p key={i} className="note">Your plan doesn't include {c.feature}. Upgrade from Billing in your dashboard.</p>;
                  return null;
                })}
              </div>
            ))}
            {busy && <div className="msg msg--assistant"><p className="bubble typing">Working on it…</p></div>}
            {error && <p className="warn" role="alert">{error}</p>}
            <div ref={endRef} />
          </div>

          <Composer disabled={busy} onSend={send} />
          {sheet && <TopUp api={api} onClose={() => setSheet(false)} onWallet={setWallet} />}
        </section>
      )}
      {!open && (
        <button type="button" className="launcher" onClick={() => setOpen(true)} aria-label="Open Bandhu AI">
          <span className="brand-mark" aria-hidden="true">ब</span> Ask Bandhu
        </button>
      )}
    </div>
  );
}
