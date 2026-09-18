import { useEffect, useState } from 'react';
import type { Api } from '../../api';
import type { LedgerEntry, ThemeChoice, Wallet } from '../../types';
import { Icon } from '../ui/Icon';
import { useFocusTrap } from '../../lib/useFocusTrap';

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

type Props = { api: Api; wallet: Wallet | null; theme: ThemeChoice; onTheme: (t: ThemeChoice) => void; onWallet: (w: Wallet) => void; onClose: () => void };

const when = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function AccountPanel({ api, wallet, theme, onTheme, onWallet, onClose }: Props) {
  const [tab, setTab] = useState<'tokens' | 'activity' | 'settings'>('tokens');
  const [packs, setPacks] = useState<{ code: string; tokens: number; pricePaise: number }[]>([]);
  const [usage, setUsage] = useState<{ totalTokens: number; byAction: { action: string; tokens: number; count: number }[] } | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLElement>(true, onClose);

  useEffect(() => {
    api.plans().then((p) => setPacks(p.packs)).catch(() => setMsg('Could not load token packs.'));
    api.usage().then(setUsage).catch(() => {});
  }, [api]);

  useEffect(() => {
    if (tab !== 'activity' || ledger) return;
    api.ledger().then((r) => setLedger(r.data)).catch(() => setLedger([]));
  }, [tab, ledger, api]);

  const buy = async (code: string) => {
    setMsg(null); setBuying(code);
    try {
      const order = await api.checkout('topup', code);
      await loadCheckout();
      const rzp = new window.Razorpay({
        key: order.keyId, order_id: order.razorpayOrderId, amount: order.amountPaise, currency: 'INR', name: 'Bandhu Tokens',
        description: `${order.tokens} tokens`,
        modal: { ondismiss: () => setBuying(null) },
        handler: async (resp: Record<string, string>) => {
          const r = await api.verify(resp);
          onWallet(r.wallet);
          setLedger(null);
          setMsg(`${order.tokens} tokens added.`);
          setBuying(null);
        },
      });
      rzp.open();
    } catch (e: any) {
      setMsg(e.code === 'BILLING_NOT_CONFIGURED' ? 'Payments are not set up on this server yet.' : e.message);
      setBuying(null);
    }
  };

  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label="Account and tokens">
      <button type="button" className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <section className="sheet" ref={trapRef} tabIndex={-1}>
        <header className="sheet-head">
          <h2>Account</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>

        <div className="balance">
          <span className="balance-num">{wallet ? wallet.available : '—'}</span>
          <span className="balance-label">tokens available</span>
          {wallet && (
            <p className="balance-meta">
              {wallet.planCode} plan{wallet.planStatus !== 'active' ? ` · ${wallet.planStatus}` : ''}
              {wallet.reserved > 0 ? ` · ${wallet.reserved} held for work in progress` : ''}
            </p>
          )}
          {wallet?.expiringSoon && (
            <p className="notice notice--warn">{wallet.expiringSoon.tokens} tokens expire on {when(wallet.expiringSoon.firstAt)}.</p>
          )}
        </div>

        <div className="tabs" role="tablist">
          {(['tokens', 'activity', 'settings'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>
              {t === 'tokens' ? 'Buy tokens' : t === 'activity' ? 'Activity' : 'Settings'}
            </button>
          ))}
        </div>

        <div className="sheet-body">
          {tab === 'tokens' && (
            <>
              <div className="packs">
                {packs.length === 0 && [0, 1, 2].map((i) => <span key={i} className="skeleton skeleton--pack" />)}
                {packs.map((p) => (
                  <button type="button" key={p.code} className="pack" disabled={!!buying} onClick={() => buy(p.code)}>
                    <span className="pack-tokens">{p.tokens}</span>
                    <span className="pack-unit">tokens</span>
                    <span className="pack-price">₹{(p.pricePaise / 100).toLocaleString('en-IN')}</span>
                    {buying === p.code && <span className="pack-busy">Opening…</span>}
                  </button>
                ))}
              </div>
              {usage && (
                <>
                  <h3>Used this period · {usage.totalTokens}</h3>
                  <ul className="kv">
                    {usage.byAction.map((u) => <li key={u.action}><span>{u.action.replace(/_/g, ' ')}</span><span>{u.tokens}</span></li>)}
                    {usage.byAction.length === 0 && <li className="muted"><span>Nothing used yet.</span></li>}
                  </ul>
                </>
              )}
            </>
          )}

          {tab === 'activity' && (
            <>
              {!ledger && <div className="th-skeletons">{[0, 1, 2, 3].map((i) => <span key={i} className="skeleton skeleton--row" />)}</div>}
              {ledger && ledger.length === 0 && <p className="muted">No token activity yet.</p>}
              {ledger && ledger.length > 0 && (
                <ul className="kv kv--ledger">
                  {ledger.map((l) => (
                    <li key={l.id}>
                      <span>
                        {(l.action || l.type).replace(/_/g, ' ')}
                        <em>{when(l.createdAt)}{l.reason ? ` · ${l.reason}` : ''}</em>
                      </span>
                      <span className={l.tokens < 0 ? 'neg' : 'pos'}>{l.tokens > 0 ? `+${l.tokens}` : l.tokens}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'settings' && (
            <>
              <h3>Appearance</h3>
              <div className="seg" role="group" aria-label="Theme">
                {(['light', 'system', 'dark'] as const).map((t) => (
                  <button key={t} type="button" aria-pressed={theme === t} className={theme === t ? 'is-on' : ''} onClick={() => onTheme(t)}>
                    {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'Auto'}
                  </button>
                ))}
              </div>
              <h3>Plan</h3>
              <p className="muted">
                You are on the <strong>{wallet?.planCode ?? '—'}</strong> plan.
                Plan changes are handled in Billing in your storebandhu dashboard.
              </p>
            </>
          )}
        </div>

        {msg && <p className="notice" role="status">{msg}</p>}
      </section>
    </div>
  );
}
