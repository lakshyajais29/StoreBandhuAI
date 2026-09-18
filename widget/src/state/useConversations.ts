import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from '../api';
import type { ConversationSummary } from '../types';

export type ConversationView = 'active' | 'archived';
const PAGE = 25;

/**
 * Sidebar list state. The server is the only store — this holds a page window over it,
 * plus cursor pagination via the nextCursor the list endpoint returns.
 */
export function useConversations(api: Api) {
  const [view, setView] = useState<ConversationView>('active');
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow first page landing after the merchant already switched tabs.
  const reqRef = useRef(0);

  const reload = useCallback(async (v: ConversationView = view) => {
    const seq = ++reqRef.current;
    setLoading(true); setError(null);
    try {
      const r = await api.conversations({ status: v, limit: PAGE });
      if (seq !== reqRef.current) return;
      setItems(r.data); setCursor(r.nextCursor);
    } catch {
      if (seq !== reqRef.current) return;
      setError('Could not load your chats.');
      setItems([]); setCursor(null);
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [api, view]);

  useEffect(() => { reload(view); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const seq = reqRef.current;
    setLoadingMore(true);
    try {
      const r = await api.conversations({ status: view, before: cursor, limit: PAGE });
      if (seq !== reqRef.current) return;
      setItems((list) => {
        const seen = new Set(list.map((c) => c.id));
        return [...list, ...r.data.filter((c) => !seen.has(c.id))];
      });
      setCursor(r.nextCursor);
    } catch {
      /* keep what we have; the button stays available */
    } finally {
      if (seq === reqRef.current) setLoadingMore(false);
    }
  }, [api, cursor, loadingMore, view]);

  /** Move an existing row to the top, or insert it if the list has not seen it yet. */
  const upsert = useCallback((c: ConversationSummary) => {
    setItems((list) => [c, ...list.filter((x) => x.id !== c.id)]);
  }, []);

  const patch = useCallback((id: string, fields: Partial<ConversationSummary>) => {
    setItems((list) => list.map((x) => (x.id === id ? { ...x, ...fields } : x)));
  }, []);

  const drop = useCallback((id: string) => {
    setItems((list) => list.filter((x) => x.id !== id));
  }, []);

  const rename = useCallback(async (id: string, title: string) => {
    const before = items.find((x) => x.id === id);
    patch(id, { title });                                  // optimistic
    try {
      const c = await api.renameConversation(id, title);
      patch(id, { title: c.title });
    } catch (e) {
      if (before) patch(id, { title: before.title });      // roll back
      throw e;
    }
  }, [api, items, patch]);

  /** Archive or restore. The row leaves whichever list is on screen, because it no longer belongs there. */
  const setStatus = useCallback(async (id: string, status: 'active' | 'archived') => {
    drop(id);
    try {
      return await api.setConversationStatus(id, status);
    } catch (e) {
      await reload(view);                                   // put it back from the server
      throw e;
    }
  }, [api, drop, reload, view]);

  return {
    view, setView, items, loading, loadingMore, error,
    hasMore: !!cursor, reload: () => reload(view), loadMore, rename, setStatus, upsert, patch, drop,
  };
}
export type Conversations = ReturnType<typeof useConversations>;
