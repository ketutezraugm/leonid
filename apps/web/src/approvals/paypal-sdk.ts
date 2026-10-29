// The PayPal JS SDK is the one PayPal surface the browser may use (invariant 4): it holds the client ID
// only, and the approval itself happens in PayPal's popup. Capture goes through our own /api.
export interface PayPalButtonsConfig {
  style?: Record<string, string | number | boolean>;
  createOrder: () => Promise<string>;
  onApprove: () => Promise<void>;
  onCancel?: () => void;
  onError?: (err: unknown) => void;
}

export interface PayPalButtons {
  render: (container: HTMLElement) => Promise<void>;
  close: () => Promise<void>;
}

export interface PayPalNamespace {
  Buttons: (config: PayPalButtonsConfig) => PayPalButtons;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let loading: Promise<PayPalNamespace> | null = null;

export function loadPayPal(clientId: string, currency = 'USD'): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  loading ??= new Promise<PayPalNamespace>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons`;
    script.async = true;
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('PayPal SDK did not load')));
    script.onerror = () => {
      loading = null;
      reject(new Error('PayPal SDK did not load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
