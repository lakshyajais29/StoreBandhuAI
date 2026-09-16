import { useEffect, useState } from 'react';
import type { Api } from '../api';
import type { Wallet } from '../types';

declare global { interface Window { Razorpay?: any } }

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay'));
    document.head.appendChild(s);
  });
}

export function TopUp({ api, onClose, onWallet }: { api: Api; onClose: () => void; onWallet: (w: Wallet) => void }) {
  const [packs, setPacks] = useState<{ code: string; tokens: number; pricePaise: number }[]>([]);
  const [usage, setUsage] = useState<{ totalTokens: number; byAction: { action: string; tokens: number; count: number }[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.plans().then((p) => setPacks(p.packs)).catch(() => setMsg('Could not load token packs.'));
    api.usage().then(setUsage).catch(() => {});
  }, [api]);

  const buy = async (code: string) => {
    setMsg(null);
    try {
      const order = await api.checkout('topup', code);
      await loadCheckout();
      const rzp = new window.Razorpay({
        key: order.keyId, order_id: order.razorpayOrderId, amount: order.amountPaise, currency: 'INR', name: 'Bandhu Tokens',
        description: `${order.tokens} tokens`,
        handler: async (resp: Record<string, string>) => {
          const r = await api.verify(resp);
          onWallet(r.wallet);
          setMsg(`${order.tokens} tokens added.`);
        },
      });
      rzp.open();
    } catch (e: any) {
      setMsg(e.code === 'BILLING_NOT_CONFIGURED' ? 'Payments are not set up on this server yet.' : e.message);
    }
  };

  return (
    <section className="sheet" aria-label="Tokens">
      <header className="sheet-head">
        <h2>Bandhu Tokens</h2>
        <button type="button" className="btn-quiet" onClick={onClose}>Close</button>
      </header>
      <div className="packs">
        {packs.map((p) => (
          <button type="button" key={p.code} className="pack" onClick={() => buy(p.code)}>
            <span className="pack-tokens">{p.tokens}</span>
            <span>₹{(p.pricePaise / 100).toLocaleString('en-IN')}</span>
          </button>
        ))}
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      {usage && (
        <>
          <h3>Used this period: {usage.totalTokens}</h3>
          <ul className="usage">
            {usage.byAction.map((u) => <li key={u.action}><span>{u.action.replace(/_/g, ' ')}</span><span>{u.tokens}</span></li>)}
            {usage.byAction.length === 0 && <li className="muted">Nothing used yet.</li>}
          </ul>
        </>
      )}
    </section>
  );
}
