import type { ButtonHTMLAttributes } from 'react';

// Flat on purpose: actions read as firm targets against the soft glass.
// Danger is only for actions that stop money or can't be undone (kill switch).
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  variant = 'secondary',
  busy = false,
  busyLabel,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  busy?: boolean;
  /** Label while busy, e.g. "Saving…". Defaults to the normal label. */
  busyLabel?: string;
}) {
  return (
    <button
      {...rest}
      type={type}
      className={['btn', `btn-${variant}`, className].filter(Boolean).join(' ')}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
