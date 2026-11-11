// The PayPal JS SDK, the only PayPal code that runs in the browser (AGENTS.md invariant 4). It only
// shows PayPal's approval popup for an order the server already created; the server captures it.

export interface PayPalButtons {
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
    style?: Record<string, string | number | boolean>;
  }): PayPalButtons;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
    paypalTreasury?: PayPalNamespace;
  }
}

function injectScript(src: string, namespace?: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    if (namespace) script.dataset.namespace = namespace;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load PayPal'));
    document.head.appendChild(script);
  });
}

let loading: Promise<PayPalNamespace> | null = null;

// Loads the SDK once, with the public client id from GET /api/approvals/config.
export function loadPayPalSdk(currency = 'USD'): Promise<PayPalNamespace> {
  loading ??= (async () => {
    const res = await fetch('/api/approvals/config');
    if (!res.ok) throw new Error('PayPal is not configured on this server');
    const body = (await res.json().catch(() => null)) as { clientId?: unknown } | null;
    const clientId = typeof body?.clientId === 'string' ? body.clientId : '';
    if (!clientId) throw new Error('PayPal is not configured on this server');
    await injectScript(`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture`);
    if (!window.paypal) throw new Error('Could not load PayPal');
    return window.paypal;
  })().catch((err: unknown) => {
    loading = null; // let the next attempt try again
    throw err;
  });
  return loading;
}

let loadingTreasury: Promise<PayPalNamespace> | null = null;

// The public checkout (tickets and donations) pays the Treasury app, which has its own client id. PayPal's script keeps one
// client id per page, so it loads under its own name (window.paypalTreasury) and can never be mixed up with the Procurement
// buttons on the Approvals screen, even in one browser session.
export function loadTreasurySdk(clientId: string, currency = 'USD'): Promise<PayPalNamespace> {
  loadingTreasury ??= (async () => {
    await injectScript(
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture`,
      'paypalTreasury',
    );
    if (!window.paypalTreasury) throw new Error('Could not load PayPal');
    return window.paypalTreasury;
  })().catch((err: unknown) => {
    loadingTreasury = null;
    throw err;
  });
  return loadingTreasury;
}
