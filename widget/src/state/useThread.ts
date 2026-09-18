import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type Api } from '../api';
import type { AssetMap, ChatMessage, ConversationSummary, Wallet } from '../types';

const KEY = 'bandhu.conversation';
type Meta = { id: string; title: string; status: 'active' | 'archived' } | null;

const readStored = () => { try { return sessionStorage.getItem(KEY) || undefined; } catch { return undefined; } };
const writeStored = (id?: string) => {
  try { if (id) sessionStorage.setItem(KEY, id); else sessionStorage.removeItem(KEY); } catch { /* non-essential */ }
};

/**
 * The active conversation. Messages, assets and status all come from the server;
 * the only local state is the in-flight user message and the id we resume from.
 */
export function useThread(api: Api, hooks: {
  onWallet: (w: Wallet) => void;
  onConversationTouched: (c: ConversationSummary) => void;
}) {
  const { onWallet, onConversationTouched } = hooks;

  const [activeId, setActiveId] = useState<string | undefined>(readStored);
  const [meta, setMeta] = useState<Meta>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [assets, setAssets] = useState<AssetMap>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reqRef = useRef(0);
  const previews = useRef<string[]>([]);
  useEffect(() => () => { previews.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const load = useCallback(async (id: string) => {
    const seq = ++reqRef.current;
    setLoading(true); setLoadError(null); setSendError(null);
    try {
      const c = await api.conversation(id);
      if (seq !== reqRef.current) return;
      setMeta({ id: c.id, title: c.title, status: c.status });
      setMessages(c.messages);
      setAssets(c.assets || {});
    } catch (e) {
      if (seq !== reqRef.current) return;
      if (e instanceof ApiError && e.status === 404) {
        // Stale session id, or a conversation belonging to another merchant. Start clean.
        writeStored(undefined);
        setActiveId(undefined); setMeta(null); setMessages([]); setAssets({});
      } else {
        setLoadError('Could not load this chat.');
      }
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [api]);

  // Resume the last conversation once on open, and whenever the merchant picks a different one.
  useEffect(() => { if (activeId) load(activeId); }, [activeId, load]);

  const open = useCallback((id: string) => {
    if (id === activeId) return;
    writeStored(id);
    setMessages([]); setAssets({}); setMeta(null); setLoadError(null); setSendError(null);
    setActiveId(id);
  }, [activeId]);

  const reset = useCallback(() => {
    reqRef.current += 1;
    writeStored(undefined);
    setActiveId(undefined); setMeta(null); setMessages([]); setAssets({});
    setLoadError(null); setSendError(null);
  }, []);

  const refresh = useCallback(async () => { if (activeId) await load(activeId); }, [activeId, load]);

  const send = useCallback(async (text: string, files: File[]) => {
    if (busy) return;
    setBusy(true); setSendError(null);
    const urls = files.map((f) => URL.createObjectURL(f));
    previews.current.push(...urls);
    const temp: ChatMessage = {
      id: `tmp-${Date.now()}`, role: 'user', content: text, ui: null, attachments: [],
      createdAt: new Date().toISOString(), localPreview: urls,
    };
    setMessages((m) => [...m, temp]);
    try {
      const assetIds = await Promise.all(files.map((f) => api.upload(f)));
      const r = await api.chat(text, activeId, assetIds);
      const isNew = r.conversationId !== activeId;
      if (isNew) { writeStored(r.conversationId); setActiveId(r.conversationId); }
      setMessages((m) => [
        ...m.filter((x) => x.id !== temp.id),
        ...r.messages.map((x) => (x.role === 'user' ? { ...x, localPreview: urls } : x)),
      ]);
      onWallet(r.wallet);
      onConversationTouched({
        id: r.conversationId,
        // Provisional only: the server titles a new conversation from the first message.
        // The sidebar reloads right after and replaces this with the stored title.
        title: meta?.title || text.slice(0, 60),
        status: 'active',
        lastMessageAt: new Date().toISOString(),
      });
      if (isNew) setMeta({ id: r.conversationId, title: text.slice(0, 60), status: 'active' });
    } catch (e: any) {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setSendError(
        e?.code === 'RATE_LIMITED' ? 'You are sending messages too quickly. Wait a moment and try again.'
          : e?.code === 'INSUFFICIENT_TOKENS' ? 'You are out of Bandhu Tokens. Add tokens to continue.'
            : e?.code === 'ASSET_NOT_FOUND' ? 'Those photos could not be uploaded. Try attaching them again.'
              : e?.message || 'Could not reach Bandhu.',
      );
    } finally {
      setBusy(false);
    }
  }, [activeId, api, busy, meta, onConversationTouched, onWallet]);

  /** Confirm and cancel are the only calls that can execute or drop a write. */
  const decide = useCallback((kind: 'confirm' | 'cancel') => async (id: string) => {
    const r = await (kind === 'confirm' ? api.confirm(id) : api.cancel(id));
    onWallet(r.wallet);
    await refresh();
  }, [api, onWallet, refresh]);

  const markRestored = useCallback(() => setMeta((m) => (m ? { ...m, status: 'active' } : m)), []);
  const setTitle = useCallback((title: string) => setMeta((m) => (m ? { ...m, title } : m)), []);

  return {
    activeId, meta, messages, assets, loading, loadError, sendError, busy,
    open, reset, refresh, retry: () => (activeId ? load(activeId) : undefined),
    send, confirm: decide('confirm'), cancel: decide('cancel'), markRestored, setTitle,
  };
}
