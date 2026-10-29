// The PayPal JS SDK, the only PayPal code that runs in the browser (AGENTS.md invariant 4). It only
// shows PayPal's approval popup for an order the server already created; the server captures it.

interface PayPalButtons {
  isEligible(): boolean;
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
}

export interface PayPalNamespace {
  Buttons(options: {
    createOrder: () => Promise<string> | string;
    onApprove: () => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
    style?: Record<string, string>;
  }): PayPalButtons;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let loading: Promise<PayPalNamespace> | null = null;

// Loads the SDK once, with the public client id from GET /api/approvals/config.
export function loadPayPalSdk(): Promise<PayPalNamespace> {
  loading ??= (async () => {
    const res = await fetch('/api/approvals/config');
    if (!res.ok) throw new Error('PayPal is not configured on this server');
    const body = (await res.json().catch(() => null)) as { clientId?: unknown } | null;
    const clientId = typeof body?.clientId === 'string' ? body.clientId : '';
    if (!clientId) throw new Error('PayPal is not configured on this server');
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load PayPal'));
      document.head.appendChild(script);
    });
    if (!window.paypal) throw new Error('Could not load PayPal');
    return window.paypal;
  })().catch((err: unknown) => {
    loading = null; // let the next attempt try again
    throw err;
  });
  return loading;
}
