import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

vi.mock('../chat/AgentChat', () => ({ AgentChat: () => null }));

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const event = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'OpenHack 2027',
  date: '2099-03-14',
  people: 200,
  budget: 800_000,
  currency: 'USD',
};
const sponsor = (id: string, name: string, tier: string, status: string, paypalInvoiceId: string | null = null) => ({
  id,
  eventId: event.id,
  name,
  tier,
  pledged: tier === 'Gold' ? 300_000 : 250_000,
  currency: 'USD',
  status,
  paypalInvoiceId,
});
const harbor = sponsor('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Harbor Cloud', 'Gold', 'paid', 'INV2-PAID');
const lumen = sponsor('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Lumen Labs', 'Silver', 'invoiced', 'INV2-SENT');
const pixel = sponsor('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Pixel Foundry', 'Bronze', 'pledged');
const stuck = sponsor('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Kite Works', 'Bronze', 'pledged', 'INV2-HALF');

const draftFor = (s: typeof pixel) => ({
  sponsor: { id: s.id, name: s.name, tier: s.tier, pledged: s.pledged, status: s.status },
  event: { id: event.id, name: event.name, currency: 'USD' },
  draft: {
    sponsorId: s.id,
    items: [{ name: `${s.tier} sponsorship`, quantity: 1, unitAmount: s.pledged }],
    currency: 'USD',
    dueInDays: 14,
    note: 'Thank you for backing OpenHack 2027.',
    reasoning: 'Invoice the pledge as agreed.',
  },
});

type Handler = (url: string, init?: RequestInit) => Promise<Response> | undefined;

function stub(sponsors: unknown[], handler: Handler = () => undefined) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const handled = handler(url, init);
    if (handled) return handled;
    if (url === '/api/events') return json({ events: [event] });
    if (url.startsWith('/api/sponsors?')) return json({ sponsors });
    const draft = url.match(/^\/api\/sponsors\/([^/]+)\/draft/);
    if (draft) return json(draftFor([pixel, stuck].find((s) => s.id === draft[1])!));
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function openTab() {
  render(
    <MemoryRouter initialEntries={[`/events/${event.id}/money`]}>
      <App />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: 'Sponsors and invoices' }));
  return screen.findByRole('table');
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Sponsors and invoices', () => {
  it('lists each sponsor for this event with its status and next step', async () => {
    const fetch = stub([harbor, lumen, pixel, stuck]);
    await openTab();

    expect(fetch).toHaveBeenCalledWith(`/api/sponsors?eventId=${event.id}`, expect.anything());
    expect(within(rowOf('Harbor Cloud')).getByText('Paid')).toBeInTheDocument();
    expect(within(rowOf('Harbor Cloud')).getByRole('button', { name: 'Share report' })).toBeInTheDocument();
    expect(within(rowOf('Lumen Labs')).getByText('Sent')).toBeInTheDocument();
    expect(within(rowOf('Lumen Labs')).queryByRole('button', { name: /invoice|send/i })).toBeNull();
    expect(within(rowOf('Pixel Foundry')).getByText('Pledged')).toBeInTheDocument();
    expect(within(rowOf('Pixel Foundry')).getByRole('button', { name: 'Draft invoice' })).toBeInTheDocument();
    expect(within(rowOf('Kite Works')).getByText("Send didn't finish")).toBeInTheDocument();
    expect(within(rowOf('Kite Works')).getByRole('button', { name: 'Retry send' })).toBeInTheDocument();
    expect(screen.getByText(/\$3,000\.00 paid of \$10,500\.00 pledged by 4 sponsors/)).toBeInTheDocument();
  });

  it('shows the draft, then sends it to the typed address for this event', async () => {
    let sent: unknown;
    const fetch = stub([pixel], (url, init) => {
      if (init?.method === 'POST' && url.includes('/send')) {
        sent = JSON.parse(String(init.body));
        return json({ paypalInvoiceId: 'INV2-NEW', invoiceNumber: '0042', recipientViewUrl: null, resumed: false });
      }
      return undefined;
    });
    await openTab();
    fireEvent.click(screen.getByRole('button', { name: 'Draft invoice' }));

    const dialog = await screen.findByRole('dialog', { name: 'Invoice Pixel Foundry' });
    expect(await within(dialog).findByText('Bronze sponsorship')).toBeInTheDocument();
    expect(within(dialog).getByText('Thank you for backing OpenHack 2027.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(`/api/sponsors/${pixel.id}/draft?eventId=${event.id}`, expect.anything());

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invoice' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter the email address');
    expect(sent).toBeUndefined();

    fireEvent.change(within(dialog).getByLabelText('Send to'), { target: { value: 'finance@pixel.example' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invoice' }));
    expect(await screen.findByText('Invoice 0042 sent to Pixel Foundry.')).toBeInTheDocument();
    expect(sent).toMatchObject({ recipientEmail: 'finance@pixel.example', draft: { sponsorId: pixel.id } });
    expect(fetch).toHaveBeenCalledWith(`/api/sponsors/${pixel.id}/send?eventId=${event.id}`, expect.anything());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the refusal code on a 409 and refreshes the list', async () => {
    const fetch = stub([pixel], (url, init) =>
      init?.method === 'POST' && url.includes('/send')
        ? json({ error: 'This sponsor already has an invoice', code: 'already_invoiced' }, 409)
        : undefined,
    );
    await openTab();
    fireEvent.click(screen.getByRole('button', { name: 'Draft invoice' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText('Send to'), { target: { value: 'a@b.example' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invoice' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('This sponsor already has an invoice');
    expect(alert).toHaveTextContent('already_invoiced');
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/sponsors?')).length).toBe(2),
    );
  });

  it("shows PayPal's debug id when PayPal refuses the invoice", async () => {
    stub([stuck], (url, init) =>
      init?.method === 'POST' && url.includes('/send')
        ? json({ error: 'PayPal rejected the invoice request', debugId: 'f00dcafe' }, 502)
        : undefined,
    );
    await openTab();
    fireEvent.click(screen.getByRole('button', { name: 'Retry send' }));
    const dialog = await screen.findByRole('dialog', { name: "Finish Kite Works's invoice" });
    fireEvent.change(await within(dialog).findByLabelText('Send to'), { target: { value: 'a@b.example' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry send' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent("PayPal didn't accept the invoice.");
    expect(alert).toHaveTextContent('f00dcafe');
  });

  it('says when there are no sponsors yet', async () => {
    stub([]);
    render(
      <MemoryRouter initialEntries={[`/events/${event.id}/money`]}>
        <App />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Sponsors and invoices' }));
    expect(await screen.findByText('No sponsors yet')).toBeInTheDocument();
  });

  it("says a sponsor's report isn't published yet", async () => {
    stub([harbor], (url) =>
      url === `/api/reports/link/${harbor.id}` ? json({ error: 'No report is published' }, 404) : undefined,
    );
    await openTab();
    fireEvent.click(screen.getByRole('button', { name: 'Share report' }));
    expect(await screen.findByText(/Harbor Cloud's report isn't published yet/)).toBeInTheDocument();
  });
});
