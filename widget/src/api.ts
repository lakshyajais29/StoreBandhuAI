import type {
  ChatResponse, Wallet, ActionView, JobView, ConversationSummary, ConversationDetail, LedgerEntry,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}

export function createApi(baseUrl: string, getToken: () => Promise<string>) {
  let token: string | null = null;
  const base = baseUrl.replace(/\/$/, '');

  async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    if (!token) token = await getToken();
    const isBinary = body instanceof Blob;
    const res = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && !isBinary ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : isBinary ? (body as Blob) : JSON.stringify(body),
    });
    if (res.status === 401 && retry) {
      token = null;
      return request<T>(method, path, body, false);
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data?.error?.code || 'HTTP_ERROR', data?.error?.message || 'Request failed', data?.error?.details);
    return data as T;
  }

  return {
    chat: (message: string, conversationId?: string, assetIds?: string[]) =>
      request<ChatResponse>('POST', '/api/chat', { message, conversationId, assetIds }),

    conversations: (opts: { status?: 'active' | 'archived'; before?: string; limit?: number } = {}) => {
      const q = new URLSearchParams();
      if (opts.status) q.set('status', opts.status);
      if (opts.before) q.set('before', opts.before);
      if (opts.limit) q.set('limit', String(opts.limit));
      const s = q.toString();
      return request<{ data: ConversationSummary[]; nextCursor: string | null }>('GET', `/api/conversations${s ? `?${s}` : ''}`);
    },
    conversation: (id: string) => request<ConversationDetail>('GET', `/api/conversations/${id}`),
    renameConversation: (id: string, title: string) => request<ConversationSummary>('PATCH', `/api/conversations/${id}`, { title }),
    setConversationStatus: (id: string, status: 'active' | 'archived') =>
      request<ConversationSummary>('PATCH', `/api/conversations/${id}`, { status }),

    wallet: () => request<Wallet>('GET', '/api/wallet'),
    ledger: (cursor?: string) =>
      request<{ data: LedgerEntry[]; nextCursor: string | null }>('GET', `/api/wallet/ledger${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),

    /** Re-read an action's live state — stored ui cards are snapshots and go stale. */
    action: (id: string) => request<ActionView>('GET', `/api/actions/${id}`),
    confirm: (id: string) => request<{ action: ActionView; wallet: Wallet }>('POST', `/api/actions/${id}/confirm`),
    cancel: (id: string) => request<{ action: ActionView; wallet: Wallet }>('POST', `/api/actions/${id}/cancel`),

    job: (id: string) => request<JobView>('GET', `/api/jobs/${id}`),
    /** Retries attaching a finished job to the product it already named (input.productId). Never charged again. */
    attachJob: (id: string, productId?: string) => request<JobView>('POST', `/api/jobs/${id}/attach`, productId ? { productId } : {}),
    usage: () => request<{ totalTokens: number; byAction: { action: string; tokens: number; count: number }[] }>('GET', '/api/wallet/usage'),
    plans: () => request<{ plans: any[]; packs: { code: string; tokens: number; pricePaise: number }[] }>('GET', '/api/billing/plans'),
    checkout: (kind: 'plan' | 'topup', code: string) => request<{ razorpayOrderId: string; keyId: string; amountPaise: number; tokens: number }>('POST', '/api/billing/checkout', { kind, code }),
    verify: (p: Record<string, string>) => request<{ wallet: Wallet }>('POST', '/api/billing/verify', p),

    async upload(file: File): Promise<string> {
      const created = await request<{ assetId: string; upload: { method: string; url: string; headers: Record<string, string>; requiresAuth: boolean } }>(
        'POST', '/api/uploads', { mime: file.type, bytes: file.size },
      );
      if (created.upload.requiresAuth) {
        await request('PUT', created.upload.url, file);
      } else {
        const put = await fetch(created.upload.url, { method: 'PUT', headers: created.upload.headers, body: file });
        if (!put.ok) throw new ApiError(put.status, 'UPLOAD_FAILED', 'Upload failed');
      }
      await request('POST', `/api/uploads/${created.assetId}/complete`);
      return created.assetId;
    },
  };
}
export type Api = ReturnType<typeof createApi>;
