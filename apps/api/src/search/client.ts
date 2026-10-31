import { z } from 'zod';

export const TAVILY_BASE_URL = 'https://api.tavily.com';

const SEARCH_RESULTS = 5;
const REQUEST_TIMEOUT_MS = 15_000;

export class SearchNotConfiguredError extends Error {}

export class SearchApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

// The only two operations an agent can reach. There is deliberately no "fetch this URL" method:
// pages are read through the provider's extract API, so our server never requests arbitrary hosts.
export interface SearchClient {
  search(query: string): Promise<SearchResult[]>;
  extract(url: string): Promise<string>;
}

export interface SearchClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const SearchResponse = z.object({
  results: z.array(z.object({ url: z.string(), title: z.string(), content: z.string() })),
});

const ExtractResponse = z.object({
  results: z.array(z.object({ url: z.string(), raw_content: z.string() })),
  failed_results: z.array(z.object({ url: z.string(), error: z.string() })).default([]),
});

// The Tavily web client. Switched off for now: the venue scout only reads the seeded catalog, so
// nothing outside the tests calls this.
export function createSearchClient(options: SearchClientOptions): SearchClient {
  const baseUrl = options.baseUrl ?? TAVILY_BASE_URL;
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new SearchApiError(res.status, `Search provider returned HTTP ${res.status}`);
    }
    return schema.parse(await res.json());
  }

  return {
    async search(query) {
      const body = await post(
        '/search',
        {
          query,
          search_depth: 'basic',
          max_results: SEARCH_RESULTS,
          include_answer: false,
          include_raw_content: false,
        },
        SearchResponse,
      );
      return body.results
        .slice(0, SEARCH_RESULTS)
        .map((r) => ({ url: r.url, title: r.title, snippet: r.content }));
    },

    async extract(url) {
      const body = await post(
        '/extract',
        { urls: [url], extract_depth: 'basic', format: 'markdown' },
        ExtractResponse,
      );
      const page = body.results[0];
      if (!page) {
        const reason = body.failed_results[0]?.error ?? 'no content';
        throw new Error(`Could not read the page: ${reason}`);
      }
      return page.raw_content;
    },
  };
}
