import type { ChatMessage, UiCard } from '../../types';
import { Markdown } from '../../lib/markdown';
import { renderCard, type CardContext } from '../cards';
import { SystemEvent } from './SystemEvent';

const cardsOf = (m: ChatMessage): UiCard[] => (Array.isArray(m.ui) ? m.ui : m.ui ? [m.ui] : []);

type Props = {
  message: ChatMessage;
  visibleCards: UiCard[];
  assets: Record<string, { url: string | null } | undefined>;
  ctx: CardContext;
};

export function MessageRow({ message: m, visibleCards, assets, ctx }: Props) {
  const thumbs = m.localPreview?.length
    ? m.localPreview
    : (m.attachments || []).map((id) => assets[id]?.url).filter((u): u is string => !!u);

  if (!m.content && !visibleCards.length && !thumbs.length) return null;

  if (m.role === 'system_event') {
    return (
      <div className="msg msg--system_event">
        {m.content && <SystemEvent text={m.content} cards={cardsOf(m)} />}
        {visibleCards.map((c, i) => renderCard(c, `${m.id}-${i}`, ctx))}
      </div>
    );
  }

  return (
    <article className={`msg msg--${m.role}`}>
      {m.role === 'assistant' && <span className="msg-mark" aria-hidden="true">ब</span>}
      <div className="msg-body">
        {thumbs.length > 0 && (
          <div className="thumbs">
            {thumbs.map((u) => <img key={u} src={u} alt="Attached product photo" loading="lazy" />)}
          </div>
        )}
        {m.content && (
          <div className="bubble">
            {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
          </div>
        )}
        {visibleCards.map((c, i) => renderCard(c, `${m.id}-${i}`, ctx))}
      </div>
    </article>
  );
}
