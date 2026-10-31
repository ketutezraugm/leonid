import type { ReactNode } from 'react';
import { Button } from './Button';

// Loading, empty and error states for any screen that fetches data. Empty
// states say what will appear and how; errors say what to do next.
export function PageState({
  kind,
  title,
  children,
  onRetry,
}: {
  kind: 'loading' | 'empty' | 'error';
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <section
      className={`card page-state${kind === 'error' ? ' page-state-error' : ''}`}
      role={kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined}
    >
      <span className="page-state-title">{title}</span>
      {children && <span>{children}</span>}
      {kind === 'error' && onRetry && <Button onClick={onRetry}>Try again</Button>}
    </section>
  );
}
