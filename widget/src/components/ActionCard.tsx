import { useState } from 'react';
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

export function ActionCard({ action, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const waiting = action.status === 'awaiting_confirmation';
  const run = async (kind: 'confirm' | 'cancel') => {
    setBusy(kind); setErr(null);
    try { await (kind === 'confirm' ? onConfirm : onCancel)?.(action.id); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  return (
    <article className={`bill bill--${action.status}`} aria-label={TOOL_LABEL[action.tool] || 'Action'}>
      <header className="bill-head">
        <span>{TOOL_LABEL[action.tool] || action.tool}</span>
        <span className="bill-status">{STATUS_LABEL[action.status]}</span>
      </header>
      <Lines a={action} />
      {(action.preview?.warnings || []).map((w: string) => <p key={w} className="warn">{w}</p>)}
      {action.status === 'succeeded' && action.result?.summary && <p className="ok">{action.result.summary}</p>}
      {action.error && <p className="warn">{action.error.message}</p>}
      {err && <p className="warn" role="alert">{err}</p>}
      <footer className="bill-foot">
        <span className="cost">{action.tokenCost} tokens</span>
        {waiting && (
          <span className="bill-actions">
            <button type="button" className="btn-quiet" disabled={!!busy} onClick={() => run('cancel')}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel'}</button>
            <button type="button" className="btn-primary" disabled={!!busy} onClick={() => run('confirm')}>{busy === 'confirm' ? 'Confirming…' : 'Confirm'}</button>
          </span>
        )}
      </footer>
    </article>
  );
}
