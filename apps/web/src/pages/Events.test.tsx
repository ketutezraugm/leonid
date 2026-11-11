import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

vi.mock('../chat/AgentChat', () => ({ AgentChat: () => null }));

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const meetup = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Spring Meetup',
  date: '2099-05-20',
  people: 80,
  budget: 150_000,
  currency: 'USD',
};
const hack = { ...meetup, id: '22222222-2222-4222-8222-222222222222', name: 'Autumn Hack' };

// A server holding two events, answering the delete with `deleteStatus` (204 removes the event from the list).
function stubServer(
  deleteStatus: number,
  error = 'This event has money history, so it cannot be deleted.',
) {
  let events = [meetup, hack];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/events' && !init?.method) return json({ events });
    if (url === `/api/events/${meetup.id}` && init?.method === 'DELETE') {
      if (deleteStatus !== 204) return json({ error }, deleteStatus);
      events = events.filter((e) => e.id !== meetup.id);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return new Promise(() => {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function deleteMeetup() {
  render(
    <MemoryRouter initialEntries={['/events']}>
      <App />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Spring Meetup' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete event' }));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Events delete', () => {
  it('asks first, deletes, and drops the event from the list', async () => {
    const fetchMock = stubServer(204);
    await deleteMeetup();
    expect(await screen.findByText('Deleted Spring Meetup.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/events/${meetup.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(await screen.findByRole('link', { name: /Autumn Hack/ })).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(screen.queryByRole('link', { name: /Spring Meetup/ })).not.toBeInTheDocument(),
    );
  });

  it("shows the server's reason when it refuses, and keeps the event", async () => {
    stubServer(409);
    await deleteMeetup();
    expect(await screen.findByText(/money history/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Spring Meetup/ })).toBeInTheDocument();
  });

  it('cancel deletes nothing', async () => {
    const fetchMock = stubServer(204);
    render(
      <MemoryRouter initialEntries={['/events']}>
        <App />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Spring Meetup' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
});
