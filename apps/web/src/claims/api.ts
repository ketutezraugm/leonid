import {
  ApiError,
  ClaimView,
  RECEIPT_MAX_BYTES,
  ReceiptMimeType,
  VolunteerClaimsResponse,
} from '@leonid/shared';
import { ApiFailure } from '../shell/api';

// The volunteer's side of F16. The claim token comes from their link and is sent as a header, never in the
// API URL, so it stays out of request logs. Every answer is parsed with the shared schemas.

async function call<T>(url: string, token: string, parser: { parse(v: unknown): T }, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'omit',
    headers: { 'x-claim-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => null);
    const parsed = ApiError.safeParse(raw);
    throw new ApiFailure(res.status, parsed.success ? parsed.data.error : `HTTP ${res.status}`, raw);
  }
  return parser.parse(await res.json());
}

export const loadMyClaims = (token: string) => call('/api/claims/mine', token, VolunteerClaimsResponse);

// Why a photo cannot be sent, in words the volunteer can act on. Null: it can.
export function photoProblem(file: File): string | null {
  if (!ReceiptMimeType.safeParse(file.type).success) return 'Choose a JPEG, PNG or WebP photo of the receipt.';
  if (file.size > RECEIPT_MAX_BYTES) return 'That photo is over 5 MB. Take it again a little further away.';
  return null;
}

const toBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

export async function submitClaim(token: string, file: File): Promise<ClaimView> {
  return call('/api/claims/mine', token, ClaimView, { mimeType: file.type, imageBase64: await toBase64(file) });
}
