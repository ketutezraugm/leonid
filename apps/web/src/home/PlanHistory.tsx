import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VenueBookingHistoryResponse, type VenueBookingHistoryItem } from '@quartermaster/shared';
import { loadIds, saveActiveId, saveIds, withId } from '../chat/sessions';
import { eventPath, formatLongDate } from '../shell/event';
import { Drawer } from '../ui/Drawer';
import { formatMoney } from '../ui/money';
import { PageState } from '../ui/PageState';
import { VenueBookingPanel } from '../workspace/VenueBooking';
import '../workspace/workspace.css';

type Load =
  | { kind: 'loading' }
  | { kind: 'signin' }
  | { kind: 'error' }
  | { kind: 'ready'; plans: VenueBookingHistoryItem[] };

// Every venue plan across the organizer's events: the ones still to pay first, then the ones already paid. A row
// opens the full plan in a drawer, where an unpaid plan can be agreed and paid (the same panel as the agent page).
export function PlanHistory() {
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [open, setOpen] = useState<VenueBookingHistoryItem | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/venue-booking')
      .then(async (res) => {
        if (res.status === 401) return setLoad({ kind: 'signin' });
        if (!res.ok) return setLoad({ kind: 'error' });
        setLoad({ kind: 'ready', plans: VenueBookingHistoryResponse.parse(await res.json()).plans });
      })
      .catch(() => setLoad({ kind: 'error' }));
  }, []);
  useEffect(refresh, [refresh]);

  const close = useCallback(() => {
    setOpen(null);
    // A plan paid in the drawer moves to the Paid group.
    refresh();
  }, [refresh]);

  // Continue in the plan's own chat: make it the active one, then open its event's agent page.
  function openChat(plan: VenueBookingHistoryItem) {
    saveActiveId(plan.threadId);
    saveIds(withId(loadIds(), plan.threadId));
    navigate(eventPath(plan.eventId, 'agent'));
  }

  if (load.kind === 'loading') return <PageState kind="loading" title="Loading your plans…" />;
  if (load.kind === 'signin') {
    return (
      <p className="muted plan-history-note">Sign in as treasurer to see your plans and what was paid.</p>
    );
  }
  if (load.kind === 'error') {
    return <p className="muted plan-history-note">Plans could not be loaded. Try again shortly.</p>;
  }

  const toPay = load.plans.filter((p) => p.payment.status !== 'paid');
  const paid = load.plans.filter((p) => p.payment.status === 'paid');
  if (load.plans.length === 0) {
    return (
      <PageState kind="empty" title="No plans yet">
        Pick a venue in an event&apos;s agent chat and its plan shows up here.
      </PageState>
    );
  }

  return (
    <section className="plan-history" aria-label="Plan history">
      <PlanGroup title="To pay" plans={toPay} onOpen={setOpen} />
      <PlanGroup title="Paid" plans={paid} onOpen={setOpen} />
      <Drawer
        id="plan-history-drawer"
        open={open !== null}
        title={open ? `${open.summary.event.name} at ${open.summary.venue.name}` : 'Plan'}
        onClose={close}
      >
        {open && (
          <div className="plan-history-drawer">
            <VenueBookingPanel
              key={open.threadId}
              threadId={open.threadId}
              pickName={open.summary.venue.name}
              onBack={close}
              backLabel="Close"
              idle
            />
            <button type="button" className="link-button" onClick={() => openChat(open)}>
              Open in chat
            </button>
          </div>
        )}
      </Drawer>
    </section>
  );
}

function PlanGroup({
  title,
  plans,
  onOpen,
}: {
  title: string;
  plans: VenueBookingHistoryItem[];
  onOpen: (plan: VenueBookingHistoryItem) => void;
}) {
  if (plans.length === 0) return null;
  return (
    <>
      <h3 className="plan-history-title">
        {title} ({plans.length})
      </h3>
      <ul className="plan-history-list">
        {plans.map((plan) => {
          const { event, venue, payable } = plan.summary;
          return (
            <li key={plan.threadId}>
              <button type="button" className="plan-history-row" onClick={() => onOpen(plan)}>
                <span className="plan-history-name">
                  {event.name} at {venue.name}
                </span>
                <span className="plan-history-meta">{formatLongDate(event.date.slice(0, 10))}</span>
                <span className="plan-history-total num">{formatMoney(payable.amountMinor, 'USD')}</span>
                <span className={`plan-history-status plan-history-status--${plan.payment.status}`}>
                  {{ unpaid: 'Not paid', awaiting_approval: 'Waiting for approval', paid: 'Paid' }[
                    plan.payment.status
                  ]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
