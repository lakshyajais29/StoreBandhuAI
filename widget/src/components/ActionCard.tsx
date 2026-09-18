import { useEffect, useState } from 'react';
import type { ActionView } from '../types';
import { rupees, STATUS_LABEL, TOOL_LABEL } from '../format';

type Props = { action: ActionView; onConfirm?: (id: string) => Promise<void>; onCancel?: (id: string) => Promise<void> };

function Lines({ a }: { a: ActionView }) {
  const p = a.preview || {};
  if (p.kind === 'inventory') {
    return (
      <dl className="bill-lines">
        <dt>Product</dt><dd>{p.title}</dd>
        <dt>Stock now</dt><dd>{p.current_stock}</dd>
        <dt>New stock</dt><dd className="strong">{p.new_stock} <span className="muted">({p.delta > 0 ? '+' : ''}{p.delta})</span></dd>
      </dl>
    );
  }
  if (p.kind === 'order') {
    return (
      <>
        <p className="bill-party">{p.customer}<br /><span className="muted">{p.address}</span></p>
        <table className="bill-items">
          <tbody>
            {(p.items || []).map((i: any, idx: number) => (
              <tr key={idx}><td>{i.title} × {i.qty}{!i.in_stock && <em className="warn"> low stock</em>}</td><td>{rupees(i.line_total_rupees)}</td></tr>
            ))}
            <tr className="sub"><td>Tax</td><td>{rupees(p.tax_rupees)}</td></tr>
            <tr className="sub"><td>Shipping</td><td>{rupees(p.shipping_rupees)}</td></tr>
            <tr className="total"><td>Total ({p.payment_mode === 'cod' ? 'Cash on delivery' : 'Payment link'})</td><td>{rupees(p.total_rupees)}</td></tr>
          </tbody>
        </table>
      </>
    );
  }
  return (
    <dl className="bill-lines">
      <dt>Title</dt><dd className="strong">{p.title}</dd>
      <dt>Price</dt><dd>{rupees(p.price_rupees)}</dd>
      <dt>Category</dt><dd>{p.category}</dd>
      {p.stock != null && (<><dt>Stock</dt><dd>{p.stock}</dd></>)}
      {p.image_urls?.length > 0 && (<><dt>Photos</dt><dd>{p.image_urls.length}</dd></>)}
    </dl>
  );
}

/** mm:ss until expiresAt, or null once past it / not applicable. */
function useCountdown(expiresAt: string | undefined, active: boolean) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!active || !expiresAt) { setRemaining(null); return; }
    const end = new Date(expiresAt).getTime();
    const tick = () => setRemaining(Math.max(0, end - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, active]);
  return remaining;
}

function fmt(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ActionCard({ action, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const waiting = action.status === 'awaiting_confirmation';
  const inFlight = action.status === 'executing' || action.status === 'unknown';

  const remaining = useCountdown(action.expiresAt, waiting);
  const justExpired = waiting && remaining === 0;

  const run = async (kind: 'confirm' | 'cancel') => {
    setBusy(kind); setErr(null);
    try { await (kind === 'confirm' ? onConfirm : onCancel)?.(action.id); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };

  return (
    <article className={`bill bill--${action.status}`} aria-label={TOOL_LABEL[action.tool] || 'Action'}>
      <header className="bill-head">
        <span>{TOOL_LABEL[action.tool] || action.tool}</span>
        <span className="bill-status">
          {inFlight && <span className="bill-spinner" aria-hidden="true" />}
          {STATUS_LABEL[action.status]}
        </span>
      </header>
      <Lines a={action} />
      {(action.preview?.warnings || []).map((w: string) => <p key={w} className="warn">{w}</p>)}
      {action.status === 'succeeded' && action.result?.summary && <p className="ok">{action.result.summary}</p>}
      {action.status === 'unknown' && (
        <p className="notice notice--warn" style={{ margin: '0 14px 10px' }}>
          Checking with the store — this settles on its own and never double-charges you.
        </p>
      )}
      {action.error && <p className="warn">{action.error.message}</p>}
      {err && <p className="warn" role="alert">{err}</p>}
      <footer className="bill-foot">
        <span className="cost">
          {action.tokenCost} tokens
          {waiting && remaining !== null && remaining > 0 && (
            <span className="bill-countdown"> · expires in {fmt(remaining)}</span>
          )}
        </span>
        {waiting && !justExpired && (
          <span className="bill-actions">
            <button type="button" className="btn-quiet" disabled={!!busy} onClick={() => run('cancel')}>
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
            </button>
            <button type="button" className="btn-primary" disabled={!!busy} onClick={() => run('confirm')}>
              {busy === 'confirm' ? <><span className="btn-spinner" aria-hidden="true" /> Confirming…</> : 'Confirm'}
            </button>
          </span>
        )}
        {justExpired && <span className="muted">Expired — ask again for a fresh preview.</span>}
      </footer>
    </article>
  );
}
