import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { MaxSpendButton } from './MaxSpendButton';

const ID = '3f1c2a52-1111-4222-8333-444455556666';
const event = { id: ID, name: 'Spring Meetup', currency: 'USD' };

function stubSave(status = 200) {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as { maxSpend: number | null };
    const body =
      status === 200
        ? { id: ID, name: 'Spring Meetup', date: '2027-05-20', people: 80, budget: 150_000, currency: 'USD', maxSpend: sent.maxSpend }
        : { error: 'max spend request failed' };
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const renderButton = (maxSpend?: number | null) =>
  render(
    <ToastProvider>
      <MaxSpendButton event={{ ...event, maxSpend }} />
    </ToastProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('MaxSpendButton', () => {
  it('offers to add the rule, and shows the amount once it is set', () => {
    const { unmount } = renderButton(null);
    expect(screen.getByRole('button', { name: /set a max spend/i })).toHaveTextContent('Add rule');
    unmount();
    renderButton(500_000);
    expect(screen.getByRole('button', { name: /max spend \$5,000\.00/i })).toHaveTextContent('Max $5,000.00');
  });

  it('saves a plain amount as cents', async () => {
    const fetchMock = stubSave();
    renderButton(null);
    fireEvent.click(screen.getByRole('button', { name: /set a max spend/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/most the agent can spend/i), { target: { value: '5,000.50' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/events/${ID}/max-spend`);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ maxSpend: 500_050 });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('removes the maximum when the field is left empty', async () => {
    const fetchMock = stubSave();
    renderButton(500_000);
    fireEvent.click(screen.getByRole('button', { name: /max spend/i }));
    const field = screen.getByLabelText(/most the agent can spend/i);
    expect(field).toHaveValue('5000');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ maxSpend: null });
  });

  it('asks for an amount instead of sending zero or text', () => {
    const fetchMock = stubSave();
    renderButton(null);
    fireEvent.click(screen.getByRole('button', { name: /set a max spend/i }));
    for (const bad of ['0', 'lots', '12.345']) {
      fireEvent.change(screen.getByLabelText(/most the agent can spend/i), { target: { value: bad } });
      fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
      expect(screen.getByText(/enter an amount above zero/i)).toBeInTheDocument();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and says so when the server fails', async () => {
    stubSave(500);
    renderButton(null);
    fireEvent.click(screen.getByRole('button', { name: /set a max spend/i }));
    fireEvent.change(screen.getByLabelText(/most the agent can spend/i), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(/./));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText(/wrong|try again|couldn|failed/i)).toBeInTheDocument();
  });
});
