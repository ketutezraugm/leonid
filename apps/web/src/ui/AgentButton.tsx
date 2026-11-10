import { forwardRef } from 'react';

// The floating Ask-the-agent button: Leo, the mascot, simplified to one color and peeking up from the bottom edge
// of the indigo disc (a mane of two rounded squares, the face, two eyes and a nose); on hover he rises a little.
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
        <svg className="leo-peek" viewBox="0 0 24 24" aria-hidden="true">
          <g className="leo-peek-body">
            <g transform="translate(12 19.5) scale(1.15) translate(-12 -12.5)">
              <g className="leo-icon-mane">
                <rect x="5.25" y="5.75" width="13.5" height="13.5" rx="2.6" />
                <rect x="5.25" y="5.75" width="13.5" height="13.5" rx="2.6" transform="rotate(45 12 12.5)" />
              </g>
              <circle cx="12" cy="12.5" r="5.6" fill="currentColor" />
              <circle cx="10.1" cy="11.8" r="0.95" className="leo-icon-ink" />
              <circle cx="13.9" cy="11.8" r="0.95" className="leo-icon-ink" />
              <path d="M11.1 13.75h1.8l-0.9 1z" className="leo-icon-ink leo-icon-nose" />
            </g>
          </g>
        </svg>
      )}
      {working && !open && <span className="agent-button-arc" aria-hidden="true" />}
      {unread && !open && !working && <span className="agent-button-dot" aria-hidden="true" />}
    </button>
  );
});
