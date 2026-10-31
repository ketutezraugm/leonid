import { forwardRef } from 'react';

// The floating Ask-the-agent button (UX plan 3, option B): a speech bubble with a brass spark on a forest disc.
// Closed it can show Working (a brass arc) or Unread (a brass dot); open it becomes the drawer's close button.
export const AgentButton = forwardRef<
  HTMLButtonElement,
  {
    open: boolean;
    onClick: () => void;
    working?: boolean;
    unread?: boolean;
    controls?: string;
  }
>(function AgentButton({ open, onClick, working = false, unread = false, controls }, ref) {
  const state = open ? 'open' : working ? 'working' : unread ? 'unread' : 'rest';
  return (
    <button
      ref={ref}
      type="button"
      className={`agent-button agent-button--${state}`}
      aria-label={open ? 'Close the agent' : 'Ask the agent'}
      aria-expanded={open}
      aria-controls={controls}
      title={open ? 'Close' : 'Ask the agent  /'}
      onClick={onClick}
    >
      {open ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5 4.5h14a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-6.5L8 20.5V17H5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M12 7l1.1 2.6L15.7 10.7l-2.6 1.1L12 14.4l-1.1-2.6-2.6-1.1 2.6-1.1z"
            fill="var(--color-brass)"
          />
        </svg>
      )}
      {working && !open && <span className="agent-button-arc" aria-hidden="true" />}
      {unread && !open && !working && <span className="agent-button-dot" aria-hidden="true" />}
    </button>
  );
});
