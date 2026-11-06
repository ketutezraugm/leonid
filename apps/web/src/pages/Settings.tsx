import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WalletRevokeResponse, type WalletState } from '@quartermaster/shared';
import { TreasuryStatus } from '../setup/TreasuryStatus';
import { ApiFailure, errorMessage, sendJson } from '../shell/api';
import { useShellData } from '../shell/data';
import { useEvents } from '../shell/event';
import { useSession } from '../shell/session';
import { useConnectWallet } from '../shell/useConnectWallet';
import { walletConsequence } from '../shell/wallet';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/Dialog';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';
import { useToast } from '../ui/Toast';

const statusBadge: Record<WalletState, { status: 'done' | 'pending' | 'blocked'; label: string }> = {
  active: { status: 'done', label: 'Active' },
  none: { status: 'pending', label: 'Not connected' },
  revoked: { status: 'blocked', label: 'Revoked' },
};

export function Settings() {
  const { wallet } = useShellData();
  const { events } = useEvents();
  const { session, signOut } = useSession();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deletionPending, setDeletionPending] = useState(false);

  const { connect, connecting } = useConnectWallet();

  async function revoke() {
    setBusy(true);
    try {
      await sendJson('/api/wallet/revoke', WalletRevokeResponse);
      setDeletionPending(false);
      toast.success('The agent can no longer spend.');
    } catch (err) {
      // A 502 means our own spending already stopped and only PayPal's deletion is outstanding.
      if (err instanceof ApiFailure && err.status === 502) {
        setDeletionPending(true);
        toast.error("The agent is stopped, but PayPal hasn't deleted the wallet yet.");
      } else {
        toast.error("Couldn't revoke the wallet. Try again.");
      }
    } finally {
      // The server knows what really happened, so the sidebar and this card always re-read it.
      wallet.reload();
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section>
      <PageHeader title="Settings" description="Is the agent allowed to spend? This is where you stop it." />

      <Card title="Events">
        <p>
          {events.length === 1 ? `You run one event, ${events[0]!.name}.` : `You run ${events.length} events.`} The
          treasury and the agent wallet below are shared by all of them.
        </p>
        <Link to="/events">All events</Link>
      </Card>

      <Card title="Treasury">
        <TreasuryStatus />
      </Card>

      <Card title="Agent wallet">
        {wallet.kind === 'loading' && <p className="muted">Checking the wallet…</p>}
        {wallet.kind === 'error' && (
          <div role="alert">
            <p>
              <strong>{errorMessage(wallet.error).title}.</strong> {errorMessage(wallet.error).detail}{' '}
              {wallet.error.status === 401 && <Link to="/signin">Sign in</Link>}
            </p>
            <Button onClick={wallet.reload}>Try again</Button>
          </div>
        )}
        {wallet.kind === 'ready' && (
          <>
            <p>
              <StatusBadge {...statusBadge[wallet.data.status]} />
            </p>
            <p>{walletConsequence(wallet.data.status)}</p>
            {wallet.data.payerEmail && (
              <p className="muted">
                Pays from the PayPal account <strong>{wallet.data.payerEmail}</strong>.
              </p>
            )}
            {wallet.data.status === 'revoked' && deletionPending && (
              <p role="alert">
                <strong>Agent stopped, PayPal deletion pending.</strong> The agent can’t spend. Retry to finish
                deleting the wallet at PayPal.
              </p>
            )}
            <div className="btn-row">
              {wallet.data.status === 'revoked' && deletionPending && (
                <Button variant="danger" busy={busy} busyLabel="Retrying…" onClick={() => void revoke()}>
                  Retry deletion
                </Button>
              )}
              {wallet.data.status !== 'active' && !deletionPending && (
                <Button variant="primary" busy={connecting} busyLabel="Opening PayPal…" onClick={() => void connect()}>
                  Connect wallet
                </Button>
              )}
              {wallet.data.status === 'active' && (
                <Button variant="danger" onClick={() => setConfirming(true)}>
                  Revoke agent wallet
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      <Card title="Your session">
        {session.status === 'signed-in' ? (
          <>
            <p>Signed in{session.email ? ` as ${session.email}` : ''} via {session.via === 'demo' ? 'demo login' : 'PayPal'}.</p>
            <Button onClick={() => void signOut()}>Sign out</Button>
          </>
        ) : (
          <p className="muted">
            You are not signed in. <Link to="/signin">Sign in</Link>
          </p>
        )}
      </Card>

      {confirming && (
        <ConfirmDialog
          title="Revoke the agent wallet?"
          confirmLabel="Revoke agent wallet"
          busyLabel="Revoking…"
          danger
          busy={busy}
          onConfirm={() => void revoke()}
          onCancel={() => setConfirming(false)}
        >
          <p>
            The agent will no longer be able to pay for anything, in any of your events: they share this wallet. PayPal
            rejects its next charge, so this holds even if something in our app goes wrong. You can connect a new
            wallet later.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
