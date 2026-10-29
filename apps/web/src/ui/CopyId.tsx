import { useState } from 'react';

// A PayPal ID in Geist Mono that copies on click. The id is also the button's name, so it is readable without sight.
export function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the id stays selectable text.
    }
  }

  return (
    <button type="button" className="copy-id" onClick={copy} title="Copy">
      <span className="id">{value}</span>
      <span className="copy-id-state" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}
