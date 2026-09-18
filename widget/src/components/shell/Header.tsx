import type { Wallet } from '../../types';
import { Icon } from '../ui/Icon';

type Props = {
  title: string;
  archived?: boolean;
  wallet: Wallet | null;
  showMenu: boolean;
  onMenu: () => void;
  onAccount: () => void;
  onClose?: () => void;
};

export function Header({ title, archived, wallet, showMenu, onMenu, onAccount, onClose }: Props) {
  const low = !!wallet && wallet.available < 10;
  return (
    <header className="hd">
      {showMenu && (
        <button type="button" className="icon-btn" onClick={onMenu} aria-label="Open menu">
          <Icon name="menu" />
        </button>
      )}
      <h1 className="hd-title" title={title}>{title}</h1>
      {archived && <span className="tag">Archived</span>}
      <button
        type="button"
        className={`chip ${low ? 'chip--low' : ''}`}
        onClick={onAccount}
        aria-label={wallet ? `${wallet.available} tokens left. Open account.` : 'Open account'}
      >
        <Icon name="coin" size={15} />
        <span>{wallet ? wallet.available : '—'}</span>
      </button>
      {onClose && (
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close assistant">
          <Icon name="close" />
        </button>
      )}
    </header>
  );
}
