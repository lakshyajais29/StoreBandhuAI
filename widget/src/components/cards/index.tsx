import { useEffect, useState } from 'react';
import type { Api } from '../../api';
import type { ActionView, UiCard } from '../../types';
import { ActionCard } from '../ActionCard';
import { JobCard } from '../JobCard';

const TERMINAL = ['succeeded', 'failed', 'cancelled', 'expired'];

/**
 * A stable identity for a card, used to dedupe a job/action that appears once inline
 * (from the chat turn) and again as a system_event when it settles — only the newest
 * occurrence renders, so the card updates in place instead of stacking.
 * Cards with no natural identity (insufficient_tokens, upgrade_required) are never deduped.
 */
export function cardKey(c: UiCard): string | null {
  if (c.type === 'pending_action' || c.type === 'action_result') return `a:${c.action.id}`;
  if (c.type === 'job') return `j:${c.job.id}`;
  return null;
}

/**
 * Stored ui cards are snapshots taken when the message was written. A card still reading
 * `awaiting_confirmation` may already be expired, cancelled or executed elsewhere, so the
 * live state is re-read once before Confirm/Cancel are offered. The server stays the sole
 * authority either way — this only stops the UI from offering a button that would fail.
 */
function LiveAction({ action, api, onConfirm, onCancel }: {
  action: ActionView; api: Api; onConfirm: (id: string) => Promise<void>; onCancel: (id: string) => Promise<void>;
}) {
  const [view, setView] = useState(action);
  const [checked, setChecked] = useState(TERMINAL.includes(action.status));

  useEffect(() => { setView(action); setChecked(TERMINAL.includes(action.status)); }, [action]);

  useEffect(() => {
    if (checked) return;
    let alive = true;
    api.action(action.id).then((fresh) => { if (alive) { setView(fresh); setChecked(true); } }).catch(() => { if (alive) setChecked(true); });
    return () => { alive = false; };
  }, [action.id, checked, api]);

  return <ActionCard action={view} onConfirm={checked ? onConfirm : undefined} onCancel={checked ? onCancel : undefined} />;
}

export type CardContext = {
  api: Api;
  onConfirm: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onJobSettled: () => void;
  onTopUp: () => void;
};

/** Renders one ui card. Add a new `case` here (and to the UiCard union in types.ts) to support a new card type. */
export function renderCard(card: UiCard, key: string, ctx: CardContext) {
  switch (card.type) {
    case 'pending_action':
    case 'action_result':
      return <LiveAction key={key} action={card.action} api={ctx.api} onConfirm={ctx.onConfirm} onCancel={ctx.onCancel} />;
    case 'job':
      return <JobCard key={key} job={card.job} api={ctx.api} onSettled={ctx.onJobSettled} />;
    case 'insufficient_tokens':
      return (
        <div key={key} className="notice notice--warn">
          <p>You are out of Bandhu Tokens{card.required ? ` — this needs ${card.required}` : ''}.</p>
          <button type="button" className="btn-primary" onClick={ctx.onTopUp}>Add tokens</button>
        </div>
      );
    case 'upgrade_required':
      return (
        <p key={key} className="notice">
          Your plan doesn’t include {card.feature.replace(/_/g, ' ')}. Upgrade from Billing in your dashboard.
        </p>
      );
    default:
      return null;
  }
}
