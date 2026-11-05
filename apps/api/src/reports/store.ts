import { randomBytes } from 'node:crypto';
import { SponsorReportView } from '@quartermaster/shared';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sponsorReports } from '../db/schema.js';

// 24 random bytes: 192 bits, unguessable. It is the only thing that opens the public report, so it is never logged.
const newToken = () => randomBytes(24).toString('base64url');

// Publishes (or refreshes) the sponsor's report. The share link survives a refresh: only the content and the time change.
export async function publishReport(db: Db, sponsorId: string, view: SponsorReportView): Promise<void> {
  await db
    .insert(sponsorReports)
    .values({ sponsorId, shareToken: newToken(), content: view })
    .onConflictDoUpdate({ target: sponsorReports.sponsorId, set: { content: view, generatedAt: sql`now()` } });
}

// The public read. Content that no longer parses (an old shape) is treated as not found, never guessed at.
export async function getReportByToken(db: Db, shareToken: string): Promise<SponsorReportView | undefined> {
  const [row] = await db.select({ content: sponsorReports.content }).from(sponsorReports).where(eq(sponsorReports.shareToken, shareToken));
  const parsed = SponsorReportView.safeParse(row?.content);
  return parsed.success ? parsed.data : undefined;
}

// For the treasurer to copy and send to the sponsor.
export async function getReportLink(db: Db, sponsorId: string): Promise<{ shareToken: string; generatedAt: Date } | undefined> {
  const [row] = await db.select({ shareToken: sponsorReports.shareToken, generatedAt: sponsorReports.generatedAt }).from(sponsorReports).where(eq(sponsorReports.sponsorId, sponsorId));
  return row;
}
