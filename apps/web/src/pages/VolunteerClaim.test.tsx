import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VolunteerClaim } from './VolunteerClaim';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const approved = {
  id: 'c1',
  eventId: 'e1',
  volunteerName: 'Ana',
  category: 'volunteer',
  amount: 3_250,
  currency: 'USD',
  status: 'approved',
  reasons: [],
  extracted: null,
  paypalBatchId: 'BATCH-1',
  submittedAt: '2027-03-14T10:00:00.000Z',
};
const mineOk = () => json({ volunteer: { name: 'Ana', eventName: 'OpenHack 2027' }, claims: [] });

function serve(mine: () => Response = mineOk) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    void url;
    return Promise.resolve(init?.method === 'POST' ? json(approved, 201) : mine());
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const open = () =>
  render(
    <MemoryRouter initialEntries={['/claim/tok123']}>
      <Routes>
        <Route path="/claim/:token" element={<VolunteerClaim />} />
      </Routes>
    </MemoryRouter>,
  );

const choose = (file: File) => fireEvent.change(screen.getByLabelText('Snap a receipt'), { target: { files: [file] } });

afterEach(() => vi.unstubAllGlobals());

describe('VolunteerClaim', () => {
  it('greets the volunteer and sends the claim token as a header, never in the URL', async () => {
    const fetchMock = serve();
    open();

    expect(await screen.findByRole('heading', { name: 'Hi Ana' })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/claims/mine');
    expect(init.headers).toMatchObject({ 'x-claim-token': 'tok123' });
  });

  it('refuses a file that is not a photo before sending anything', async () => {
    const fetchMock = serve();
    open();
    await screen.findByRole('heading', { name: 'Hi Ana' });

    choose(new File(['%PDF'], 'r.pdf', { type: 'application/pdf' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('JPEG, PNG or WebP');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the photo and says what happened, with the claim in the list', async () => {
    const fetchMock = serve();
    open();
    await screen.findByRole('heading', { name: 'Hi Ana' });

    choose(new File([new Uint8Array([0x89, 0x50])], 'r.png', { type: 'image/png' }));

    expect(await screen.findByText('Approved for $32.50. PayPal is sending it to your account.')).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ mimeType: 'image/png', imageBase64: 'iVA=' });
    expect(screen.getByText('$32.50')).toBeInTheDocument();
  });

  it('says so when the link is not valid', async () => {
    serve(() => json({ error: 'This claim link is not valid' }, 401));
    open();

    expect(await screen.findByText(/not valid. Ask the treasurer for a new one/)).toBeInTheDocument();
  });
});
