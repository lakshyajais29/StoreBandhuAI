import type { ChatResponse, Wallet, ActionView, JobView, ChatMessage } from './types';

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
    conversation: (id: string) => request<{ id: string; messages: ChatMessage[] }>('GET', `/api/conversations/${id}`),
    wallet: () => request<Wallet>('GET', '/api/wallet'),
    confirm: (id: string) => request<{ action: ActionView; wallet: Wallet }>('POST', `/api/actions/${id}/confirm`),
    cancel: (id: string) => request<{ action: ActionView; wallet: Wallet }>('POST', `/api/actions/${id}/cancel`),
    job: (id: string) => request<JobView>('GET', `/api/jobs/${id}`),
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
