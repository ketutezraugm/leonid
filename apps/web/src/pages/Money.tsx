import { lazy, Suspense, useEffect, useState } from 'react';
import { Payouts } from '../money/Payouts';
import { prefetchCommandCenter } from '../money/use-command-center-data';
import { useEvent } from '../shell/event';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';
import { TabPanel, Tabs } from '../ui/Tabs';

// AG Studio is a large bundle, so it loads only when the Command center tab is first shown.
const CommandCenter = lazy(() => import('../money/CommandCenter'));

const tabs = [
  { id: 'command', label: 'Command center' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'sponsors', label: 'Sponsors and invoices' },
  { id: 'audit', label: 'Audit log' },
];

export function Money() {
  const [tab, setTab] = useState('command');
  const eventId = useEvent().id;
  // Ask for the numbers now, while AG Studio's bundle is still downloading, not after it has loaded. The
  // command center picks up this same request.
  useEffect(() => {
    // Only once the event's id is known, so it is the same request the command center will ask for.
    if (tab === 'command' && eventId) prefetchCommandCenter(eventId);
  }, [tab, eventId]);
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
        {tab === 'payouts' && <Payouts />}
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
