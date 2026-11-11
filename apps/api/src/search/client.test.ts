import { describe, expect, it, vi } from 'vitest';
import { SearchApiError, createSearchClient } from './client.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(res: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(res);
  return { client: createSearchClient({ apiKey: 'tvly-key', fetch }), fetch };
}

describe('createSearchClient', () => {
  it('searches with a bearer key and maps results', async () => {
    const { client, fetch } = setup(
      json(200, {
        results: [{ url: 'https://a.test', title: 'A', content: 'snippet', score: 0.9 }],
      }),
    );
    await expect(client.search('meeting room jogja')).resolves.toEqual([
      { url: 'https://a.test', title: 'A', snippet: 'snippet' },
    ]);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.tavily.com/search');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tvly-key');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      query: 'meeting room jogja',
      max_results: 5,
      include_answer: false,
    });
  });

  it('extracts one page as markdown', async () => {
    const { client, fetch } = setup(
      json(200, { results: [{ url: 'https://a.test/p', raw_content: '# Paket meeting' }] }),
    );
    await expect(client.extract('https://a.test/p')).resolves.toBe('# Paket meeting');
    expect(JSON.parse(fetch.mock.calls[0]![1]?.body as string)).toEqual({
      urls: ['https://a.test/p'],
      extract_depth: 'basic',
      format: 'markdown',
    });
  });

  it('reports a per-URL extraction failure even on HTTP 200', async () => {
    const { client } = setup(
      json(200, { results: [], failed_results: [{ url: 'https://a.test', error: 'blocked' }] }),
    );
    await expect(client.extract('https://a.test')).rejects.toThrow('blocked');
  });

  it('throws SearchApiError on a provider error status', async () => {
    const { client } = setup(json(432, { detail: 'plan limit' }));
    await expect(client.search('x')).rejects.toMatchObject({
      name: 'Error',
      status: 432,
    });
    await expect(setup(json(401, {})).client.search('x')).rejects.toBeInstanceOf(SearchApiError);
  });

  it('rejects a response that does not match the schema', async () => {
    const { client } = setup(json(200, { results: [{ nope: true }] }));
    await expect(client.search('x')).rejects.toThrow();
  });
});
