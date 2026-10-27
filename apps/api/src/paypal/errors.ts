import { z } from 'zod';

// REST APIs reply with { name, message, debug_id, details[] }; the OAuth endpoint uses { error, error_description }.
const RestErrorBody = z.object({
  name: z.string(),
  message: z.string().optional(),
  debug_id: z.string().optional(),
  details: z.array(z.object({ issue: z.string(), description: z.string().optional() })).optional(),
});
const OAuthErrorBody = z.object({ error: z.string(), error_description: z.string().optional() });

export class PayPalApiError extends Error {
  readonly status: number;
  readonly errorName: string;
  // Branch on this (e.g. INSTRUMENT_DECLINED), never on the human-readable message.
  readonly issue: string | undefined;
  readonly debugId: string | undefined;

  constructor(init: {
    status: number;
    errorName: string;
    issue?: string;
    debugId?: string;
    detail?: string;
  }) {
    const where = init.debugId ? ` (debug_id ${init.debugId})` : '';
    super(
      `PayPal ${init.status} ${init.issue ?? init.errorName}${where}${init.detail ? `: ${init.detail}` : ''}`,
    );
    this.name = 'PayPalApiError';
    this.status = init.status;
    this.errorName = init.errorName;
    this.issue = init.issue;
    this.debugId = init.debugId;
  }
}

export function toPayPalApiError(
  status: number,
  body: unknown,
  headerDebugId: string | null,
): PayPalApiError {
  const rest = RestErrorBody.safeParse(body);
  if (rest.success) {
    const first = rest.data.details?.[0];
    return new PayPalApiError({
      status,
      errorName: rest.data.name,
      issue: first?.issue,
      debugId: rest.data.debug_id ?? headerDebugId ?? undefined,
      detail: first?.description ?? rest.data.message,
    });
  }
  const oauth = OAuthErrorBody.safeParse(body);
  if (oauth.success) {
    return new PayPalApiError({
      status,
      errorName: oauth.data.error,
      debugId: headerDebugId ?? undefined,
      detail: oauth.data.error_description,
    });
  }
  return new PayPalApiError({
    status,
    errorName: 'UNKNOWN_ERROR',
    debugId: headerDebugId ?? undefined,
  });
}
