import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

const REPORT = {
  sponsor: { name: 'Harbor Cloud', tier: 'gold' },
  event: { name: 'OpenHack 2027', date: '2027-03-14T00:00:00.000Z' },
  currency: 'USD',
  funds: { pledgedMinor: 300_000, clearedMinor: 300_000, status: 'paid' },
  spend: {
    totalMinor: 104_000,
    directMinor: 20_000,
    sharedMinor: 84_000,
    byCategory: [
      { category: 'swag', attributedMinor: 84_000, purchases: 1 },
      { category: 'printing', attributedMinor: 20_000, purchases: 1 },
    ],
    lines: [
      { at: '2026-11-04T10:00:00.000Z', category: 'swag', vendor: 'Lanyard Co', purchaseMinor: 140_000, attributedMinor: 84_000, basis: 'shared', paypalId: 'PP-r1' },
      { at: '2026-11-04T11:00:00.000Z', category: 'printing', vendor: 'Gold Prints', purchaseMinor: 20_000, attributedMinor: 20_000, basis: 'direct', paypalId: null },
    ],
  },
  narrative: { text: 'Thank you for sponsoring OpenHack 2027.', source: 'ai' },
  generatedAt: '2026-11-05T12:00:00.000Z',
};

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

function open(token: string, answer: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn((url: string) => (url === `/api/reports/${token}` ? answer() : json({ error: 'unauthorized' }, 401))));
  render(
    <MemoryRouter initialEntries={[`/report/${token}`]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('the public sponsor report page', () => {
  it('shows the figures, the categories, each purchase with its PayPal id, and says when an AI wrote the summary', async () => {
    open('tok', () => json(REPORT));
    expect(await screen.findByText('Harbor Cloud: sponsor report')).toBeTruthy();
    expect(screen.getByText('Thank you for sponsoring OpenHack 2027.')).toBeTruthy();
    expect(screen.getByText(/Written by an AI assistant/)).toBeTruthy();
    expect(screen.getAllByText('$3,000.00', { selector: '.stat-value' })).toHaveLength(2); // pledged and received
    expect(screen.getByText('$1,040.00', { selector: '.stat-value' })).toBeTruthy();
    expect(screen.getByText('Lanyard Co · swag')).toBeTruthy();
    expect(screen.getByText('PP-r1')).toBeTruthy();
    expect(screen.getByText('funded by you')).toBeTruthy();
  });

  it("shows what PayPal's own records said about each purchase, worded so a missing record is not an accusation", async () => {
    const lines = [
      { ...REPORT.spend.lines[0], paypalCheck: 'confirmed' },
      { ...REPORT.spend.lines[1], paypalId: 'PP-x', paypalCheck: 'not_found' },
    ];
    open('tok', () => json({ ...REPORT, spend: { ...REPORT.spend, lines, paypalCheckedAt: '2026-11-05T12:00:00.000Z' } }));
    expect(await screen.findByText('Confirmed by PayPal')).toBeTruthy();
    expect(screen.getByText("Not in PayPal's records yet")).toBeTruthy();
    expect(screen.getByText(/1 of 2 purchases confirmed in PayPal's transaction records on Nov 5, 2026/)).toBeTruthy();
    expect(screen.queryByText(/accus|fraud|wrong|error/i)).toBeNull();
  });

  it('says nothing about PayPal\'s records when no check ran', async () => {
    open('tok', () => json(REPORT));
    await screen.findByText('Harbor Cloud: sponsor report');
    expect(screen.queryByText(/Confirmed by PayPal/)).toBeNull();
    expect(screen.queryByText(/transaction records/)).toBeNull();
  });

  it('says "1 purchase" for a single purchase', async () => {
    open('tok', () => json({ ...REPORT, spend: { ...REPORT.spend, lines: [REPORT.spend.lines[0]] } }));
    expect(await screen.findByText('1 purchase', { selector: '.stat-meta' })).toBeTruthy();
  });

  it('does not claim an AI wrote a template summary', async () => {
    open('tok', () => json({ ...REPORT, narrative: { text: 'Thank you.', source: 'template' } }));
    await screen.findByText('Thank you.');
    expect(screen.queryByText(/Written by an AI assistant/)).toBeNull();
  });

  it('says plainly when nothing has been spent yet', async () => {
    open('tok', () => json({ ...REPORT, spend: { ...REPORT.spend, totalMinor: 0, directMinor: 0, sharedMinor: 0, byCategory: [], lines: [] } }));
    expect(await screen.findByText('Nothing has been spent from your sponsorship yet.')).toBeTruthy();
  });

  it('says it cannot find a report for an unknown link', async () => {
    open('nope', () => json({ error: 'No such report' }, 404));
    expect(await screen.findByText("We couldn't find this report")).toBeTruthy();
  });

  it('shows a retry for a server failure', async () => {
    open('tok', () => json({ error: 'boom' }, 500));
    expect(await screen.findByText("This report isn't available right now")).toBeTruthy();
  });
});
