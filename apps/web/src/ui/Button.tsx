import type { ButtonHTMLAttributes } from 'react';

// Primary is the one forest-green action per screen; secondary is a quiet grey.
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
