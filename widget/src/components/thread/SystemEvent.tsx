import type { UiCard } from '../../types';
import { Icon } from '../ui/Icon';

/** The chat turn appends `[action pa_xxx: tool status]` to system_event content for the audit trail; never shown. */
const clean = (text: string) => text.replace(/\s*\[action .*\]$/, '');

function outcomeOf(cards: UiCard[]): 'ok' | 'warn' | 'bad' | 'neutral' {
  for (const c of cards) {
    const status = c.type === 'action_result' ? c.action.status : c.type === 'job' ? c.job.status : null;
    if (status === 'succeeded') return 'ok';
    if (status === 'failed' || status === 'expired') return 'bad';
    if (status === 'cancelled' || status === 'unknown') return 'warn';
  }
  return 'neutral';
}

export function SystemEvent({ text, cards }: { text: string; cards: UiCard[] }) {
  const outcome = outcomeOf(cards);
  const icon: 'check' | 'close' | 'refresh' | 'dot' =
    outcome === 'ok' ? 'check' : outcome === 'bad' ? 'close' : outcome === 'warn' ? 'refresh' : 'dot';
  return (
    <div className={`sys-event sys-event--${outcome}`}>
      <Icon name={icon} size={13} />
      <span>{clean(text)}</span>
    </div>
  );
}
