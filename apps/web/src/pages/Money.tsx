import { lazy, Suspense, useState } from 'react';
import { useEvent } from '../shell/event';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';
import { TabPanel, Tabs } from '../ui/Tabs';

// AG Studio is a large bundle, so it loads only when the Command center tab is first shown.
const CommandCenter = lazy(() => import('../money/CommandCenter'));

const tabs = [
  { id: 'command', label: 'Command center' },
  { id: 'sponsors', label: 'Sponsors and invoices' },
  { id: 'audit', label: 'Audit log' },
];

export function Money() {
  const event = useEvent();
  const [tab, setTab] = useState('command');
  // The command center's widgets are sample data for any event id, so another event gets an honest empty state
  // until its sponsors, invoices and payouts exist.
  if (event.id !== null) {
    return (
      <section>
        <PageHeader title="Money" description="Where the event's money came from and where it went." />
        <PageState kind="empty" title="No money yet">
          This event has no sponsors, invoices or payments. Money appears here once sponsor money clears, and Event home
          shows the unlocked budget.
        </PageState>
      </section>
    );
  }
  return (
    <section>
      <PageHeader
        title="Money"
        description="Where the event's money came from and where it went. The line above the widgets says which numbers are live and which are still sample."
      />
      <Tabs items={tabs} selected={tab} onSelect={setTab} label="Money views" />
      <TabPanel>
        {tab === 'command' && (
          <Suspense fallback={<p className="muted">Loading the command center…</p>}>
            <CommandCenter />
          </Suspense>
        )}
        {tab === 'sponsors' && (
          <PageState kind="empty" title="Sponsors and invoices">
            Each sponsor’s tier, amount, contact email and invoice status will list here with one
            action per row. It needs the sponsor list endpoint from P3.
          </PageState>
        )}
        {tab === 'audit' && (
          <PageState kind="empty" title="Audit log">
            Every agent action with its rule result, reason and PayPal ID will list here. It needs
            the audit entries endpoint from P1.
          </PageState>
        )}
      </TabPanel>
    </section>
  );
}
