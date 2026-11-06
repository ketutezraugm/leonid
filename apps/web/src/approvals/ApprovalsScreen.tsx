import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApprovalsResponse } from '@quartermaster/shared';
import { timeAgo } from '../chat/sessions';
import { errorMessage, useFetch } from '../shell/api';
import { useShellData } from '../shell/data';
import { useEvent, withEvent } from '../shell/event';
import { walletConsequence } from '../shell/wallet';
import { formatMoney } from '../ui/money';
import { PageState } from '../ui/PageState';
import { ApprovalDetail } from './ApprovalDetail';
import { approvalTitle, waitingItems } from './capture';

const parseConfig = {
  parse(value: unknown): { clientId: string } {
    const v = value as { clientId?: unknown } | null;
    if (!v || typeof v.clientId !== 'string') throw new Error('Unexpected approvals config');
    return { clientId: v.clientId };
  },
};

// A queue on the left (oldest first), the selected item on the right. On a phone they stack.
export function ApprovalsScreen() {
  const event = useEvent();
  const list = useFetch(withEvent('/api/approvals', event), ApprovalsResponse);
  const config = useFetch('/api/approvals/config', parseConfig);
  const { wallet, refreshApprovals } = useShellData();
  const [selected, setSelected] = useState<string | null>(null);

  const waiting = useMemo(() => (list.kind === 'ready' ? waitingItems(list.data.approvals) : []), [list]);
  const current = waiting.find((item) => item.id === selected) ?? waiting[0];

  if (list.kind === 'loading') return <PageState kind="loading" title="Loading approvals…" />;
  if (list.kind === 'error') {
    const message = errorMessage(list.error);
    return (
      <PageState kind="error" title={message.title} onRetry={list.reload}>
        {message.detail} {list.error.status === 401 && <Link to="/signin">Sign in</Link>}
      </PageState>
    );
  }
  if (!current) {
    return (
      <PageState kind="empty" title="Nothing is waiting on you">
        Carts and claims over your rules appear here, with the agent’s reasoning.
      </PageState>
    );
  }

  const walletBlocked =
    wallet.kind === 'ready' && wallet.data.status !== 'active'
      ? `${walletConsequence(wallet.data.status)} Approvals are disabled until a wallet is connected.`
      : null;

  return (
    <div className="approvals-layout">
      <nav className="approval-queue" aria-label="Waiting approvals">
        <ul>
          {waiting.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="approval-row"
                aria-current={item.id === current.id ? 'true' : undefined}
                onClick={() => setSelected(item.id)}
              >
                <span className="approval-row-title">
                  {approvalTitle(item)}
                  {item.kind === 'payout' && <span className="muted"> · payout</span>}
                </span>
                <span className="num">{formatMoney(item.amountMinor, item.currency)}</span>
                <small className="muted">{timeAgo(item.createdAt)}</small>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <ApprovalDetail
        key={current.id}
        item={current}
        clientId={config.kind === 'ready' ? config.data.clientId : null}
        walletBlocked={walletBlocked}
        onResolved={() => {
          setSelected(null);
          list.reload();
          refreshApprovals();
        }}
      />
    </div>
  );
}
