export type Wallet = {
  available: number; reserved: number; planCode: string; planStatus: string;
  planRenewsAt: string | null; expiringSoon: { tokens: number; firstAt: string } | null;
  paidAvailable?: number; trialAvailable?: number;
};

export type ActionView = {
  id: string; tool: string; status: 'awaiting_confirmation' | 'executing' | 'succeeded' | 'failed' | 'unknown' | 'cancelled' | 'expired';
  preview: Record<string, any>; tokenCost: number; expiresAt?: string; result: Record<string, any> | null;
  error: { code: string; message: string } | null;
};

export type JobView = {
  id: string; kind: 'image' | 'video'; status: 'queued' | 'running' | 'succeeded' | 'failed'; tokenCost: number; style?: string;
  resultUrl: string | null; productId: string | null; attachStatus: string; error: { code: string; message: string } | null;
};

export type UiCard =
  | { type: 'pending_action'; action: ActionView }
  | { type: 'action_result'; action: ActionView }
  | { type: 'job'; job: JobView }
  | { type: 'insufficient_tokens'; required?: number; available?: number }
  | { type: 'upgrade_required'; feature: string };

export type ChatMessage = {
  id: string; role: 'user' | 'assistant' | 'system_event'; content: string;
  ui: UiCard[] | UiCard | null; attachments: string[]; createdAt: string;
  localPreview?: string[];
};

export type ChatResponse = { conversationId: string; messages: ChatMessage[]; wallet: Wallet; error?: { code: string } };

/** Asset ids on a message resolve through the map returned beside the thread. */
export type AssetRef = { id: string; url: string | null; mime: string | null };
export type AssetMap = Record<string, AssetRef>;

export type ConversationSummary = {
  id: string; title: string; status: 'active' | 'archived'; lastMessageAt: string;
};

export type ConversationDetail = {
  id: string; title: string; status: 'active' | 'archived'; messages: ChatMessage[]; assets: AssetMap;
};

export type LedgerEntry = {
  id: string; type: string; tokens: number; availableAfter: number;
  action: string | null; reason: string | null; createdAt: string;
};

export type ThemeChoice = 'light' | 'dark' | 'system';

export type MountOptions = {
  apiBaseUrl: string;
  /** Returns a fresh merchant session JWT from Laravel. Called on start and on 401. */
  getToken: () => Promise<string>;
  target?: HTMLElement;
  startOpen?: boolean;
  /** 'panel' keeps the floating dashboard assistant (default). 'workspace' fills its container. */
  mode?: 'panel' | 'workspace';
};
