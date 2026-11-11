import { WalletConnectResponse } from '@leonid/shared';
import { useState } from 'react';
import { useToast } from '../ui/Toast';
import { ApiFailure, sendJson } from './api';

// Starts Connect wallet (F13): a full-page redirect to PayPal, which returns to /?wallet=connected|error|cancelled.
// Used by Settings and by the setup flow's last step.
export function useConnectWallet() {
  const toast = useToast();
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    setConnecting(true);
    try {
      const { approveUrl } = await sendJson('/api/wallet/connect', WalletConnectResponse);
      window.location.assign(approveUrl);
    } catch (err) {
      setConnecting(false);
      toast.error(
        err instanceof ApiFailure && err.status === 409
          ? 'A wallet is already connected. Revoke it first.'
          : "Couldn't start the PayPal connection. Try again.",
      );
    }
  }

  return { connect, connecting };
}
