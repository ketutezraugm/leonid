import {
  InvoiceDraftResponse,
  SendInvoiceRequest,
  SentInvoiceResponse,
  SponsorReportLink,
  SponsorsResponse,
  type SponsorSummary,
} from '@quartermaster/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiFailure, errorMessage, getJson, sendJson, useFetch } from '../shell/api';
import { useEvent, withEvent } from '../shell/event';
import { Button } from '../ui/Button';
import { CopyId } from '../ui/CopyId';
import { ConfirmDialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { formatMoney } from '../ui/money';
import { PageState } from '../ui/PageState';
import { StatusBadge, type Status } from '../ui/StatusBadge';
import { useToast } from '../ui/Toast';
import './sponsors.css';

// F4 on the Money screen: each sponsor's pledge, its invoice status and the one next step. Sending asks a sponsor
// for money, so the treasurer reads the draft and types the recipient first (the sponsor row stores no email).
// "Paid" comes only from PayPal's INVOICING.INVOICE.PAID webhook; while an invoice is out the list polls for it.

const POLL_MS = 10_000;

// What the API adds to an error: the refusal code (409 and 422) or PayPal's debug id (502).
function failureDetail(body: unknown): { code?: string; debugId?: string } {
  if (typeof body !== 'object' || body === null) return {};
  const { code, debugId } = body as Record<string, unknown>;
  return {
    code: typeof code === 'string' ? code : undefined,
    debugId: typeof debugId === 'string' ? debugId : undefined,
  };
}

type Action = 'draft' | 'retry' | 'share' | null;

// The tab's status vocabulary (UX plan, Money). A pledge with a PayPal invoice id is a send that stopped between
// creating and sending the invoice; sending again finishes the same invoice and never creates a second one.
function rowState(s: SponsorSummary): { label: string; status: Status; action: Action } {
  if (s.status === 'paid') return { label: 'Paid', status: 'done', action: 'share' };
  if (s.status === 'invoiced') return { label: 'Sent', status: 'progress', action: null };
  if (s.status === 'cancelled') return { label: 'Cancelled', status: 'blocked', action: null };
  if (s.paypalInvoiceId) return { label: "Send didn't finish", status: 'risk', action: 'retry' };
  return { label: 'Pledged', status: 'pending', action: 'draft' };
}

function failureText(err: unknown): { text: string; code?: string } {
  if (!(err instanceof ApiFailure)) return { text: errorMessage(new ApiFailure(0, '')).title };
  const { code, debugId } = failureDetail(err.body);
  if (err.status === 409) return { text: `${err.message}. The list has been refreshed.`, code };
  if (err.status === 422 && code === 'draft_mismatch') return { text: "This draft doesn't match the pledge.", code };
  if (err.status === 422) return { text: 'Enter the email address the sponsor pays from.' };
  if (err.status === 404) return { text: "This sponsor isn't in this event any more." };
  if (err.status === 502) return { text: "PayPal didn't accept the invoice.", code: debugId };
  return { text: errorMessage(err).title };
}

function SendInvoiceDialog({
  sponsor,
  eventId,
  onClose,
  onSent,
}: {
  sponsor: SponsorSummary;
  eventId: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const scoped = (url: string) => withEvent(url, { id: eventId });
  const base = `/api/sponsors/${encodeURIComponent(sponsor.id)}`;
  const draft = useFetch(scoped(`${base}/draft`), InvoiceDraftResponse);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ text: string; code?: string } | null>(null);

  async function send(request: SendInvoiceRequest) {
    setBusy(true);
    setFailure(null);
    try {
      const sent = await sendJson(scoped(`${base}/send`), SentInvoiceResponse, request);
      toast.success(`Invoice ${sent.invoiceNumber ?? sent.paypalInvoiceId} sent to ${sponsor.name}.`);
      onSent();
      onClose();
    } catch (err) {
      setFailure(failureText(err));
      if (err instanceof ApiFailure && err.status === 409) onSent();
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (draft.kind !== 'ready' || busy) return;
    const body = SendInvoiceRequest.safeParse({ draft: draft.data.draft, recipientEmail: email.trim() });
    if (!body.success) {
      setFailure({ text: 'Enter the email address the sponsor pays from, like finance@example.com.' });
      return;
    }
    void send(body.data);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    confirm();
  }

  const retry = Boolean(sponsor.paypalInvoiceId);
  return (
    <ConfirmDialog
      title={retry ? `Finish ${sponsor.name}'s invoice` : `Invoice ${sponsor.name}`}
      confirmLabel={retry ? 'Retry send' : 'Send invoice'}
      busyLabel="Sending through PayPal…"
      busy={busy}
      confirmDisabled={draft.kind !== 'ready'}
      onConfirm={confirm}
      onCancel={onClose}
    >
      {draft.kind === 'loading' && <p className="muted">Drafting the invoice from the pledge…</p>}
      {draft.kind === 'error' && (
        <PageState kind="error" title="Couldn't draft this invoice" onRetry={draft.reload}>
          {errorMessage(draft.error).detail}
        </PageState>
      )}
      {draft.kind === 'ready' && (
        <form className="invoice-draft" onSubmit={onSubmit}>
          {retry && (
            <p>
              PayPal already has this invoice, but it wasn't sent. Sending again finishes the same invoice; the
              sponsor is never invoiced twice.
            </p>
          )}
          <table className="table invoice-lines">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {draft.data.draft.items.map((item, i) => (
                <tr key={i}>
                  <td>
                    {item.name}
                    {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                  </td>
                  <td className="num">{formatMoney(item.unitAmount * item.quantity, draft.data.draft.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Due in {draft.data.draft.dueInDays} days</th>
                <td className="num invoice-total">
                  {formatMoney(
                    draft.data.draft.items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0),
                    draft.data.draft.currency,
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
          {draft.data.draft.note && (
            <div className="invoice-note">
              <span className="field-hint">Note the sponsor sees</span>
              <p>{draft.data.draft.note}</p>
            </div>
          )}
          <Field
            id="invoice-email"
            label="Send to"
            type="email"
            autoComplete="off"
            placeholder="finance@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="The sponsor gets a PayPal invoice at this address and pays it there."
          />
          {failure && (
            <p className="field-error" role="alert">
              {failure.text}
              {failure.code && (
                <>
                  {' '}
                  <span className="id">{failure.code}</span>
                </>
              )}
            </p>
          )}
        </form>
      )}
    </ConfirmDialog>
  );
}

function ShareReportButton({ sponsor }: { sponsor: SponsorSummary }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function share() {
    setBusy(true);
    try {
      const { shareToken } = await getJson(
        `/api/reports/link/${encodeURIComponent(sponsor.id)}`,
        SponsorReportLink,
      );
      const link = `${window.location.origin}/report/${encodeURIComponent(shareToken)}`;
      try {
        await navigator.clipboard.writeText(link);
        toast.success(`Copied ${sponsor.name}'s report link.`);
      } catch {
        toast.success(`${sponsor.name}'s report: ${link}`);
      }
    } catch (err) {
      toast.error(
        err instanceof ApiFailure && err.status === 404
          ? `${sponsor.name}'s report isn't published yet. It's written after the event.`
          : errorMessage(err instanceof ApiFailure ? err : new ApiFailure(0, '')).title,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button busy={busy} busyLabel="Getting the link…" onClick={() => void share()}>
      Share report
    </Button>
  );
}

export function Sponsors() {
  const event = useEvent();
  const list = useFetch(withEvent('/api/sponsors', event), SponsorsResponse);
  const [sending, setSending] = useState<SponsorSummary | null>(null);
  const { refresh } = list;
  const waiting = list.kind === 'ready' && list.data.sponsors.some((s) => s.status === 'invoiced');

  // No push channel: while an invoice is out, look again every few seconds so "Paid" shows up on its own.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  if (list.kind === 'loading') return <PageState kind="loading" title="Loading sponsors…" />;
  if (list.kind === 'error') {
    return (
      <PageState kind="error" title={errorMessage(list.error).title} onRetry={list.reload}>
        {errorMessage(list.error).detail}
      </PageState>
    );
  }

  const { sponsors } = list.data;
  if (sponsors.length === 0) {
    return (
      <PageState kind="empty" title="No sponsors yet">
        Sponsors and their pledges come from the event setup. Each one gets a PayPal invoice from here.
      </PageState>
    );
  }

  const currency = sponsors[0]!.currency;
  const pledged = sponsors.reduce((sum, s) => sum + s.pledged, 0);
  const paid = sponsors.filter((s) => s.status === 'paid').reduce((sum, s) => sum + s.pledged, 0);

  return (
    <section className="sponsors" aria-label="Sponsors and invoices">
      <p className="muted sponsors-summary">
        {formatMoney(paid, currency)} paid of {formatMoney(pledged, currency)} pledged by {sponsors.length}{' '}
        {sponsors.length === 1 ? 'sponsor' : 'sponsors'}.
        {waiting && ' Paid invoices show up here on their own.'}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Sponsor</th>
              <th scope="col">Tier</th>
              <th scope="col" className="num">
                Pledged
              </th>
              <th scope="col">Invoice</th>
              <th scope="col">PayPal invoice</th>
              <th scope="col">
                <span className="visually-hidden">Next step</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sponsors.map((s) => {
              const row = rowState(s);
              return (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td>{s.tier}</td>
                  <td className="num">{formatMoney(s.pledged, s.currency)}</td>
                  <td>
                    <StatusBadge status={row.status} label={row.label} />
                  </td>
                  <td>{s.paypalInvoiceId ? <CopyId value={s.paypalInvoiceId} /> : <span className="muted">None</span>}</td>
                  <td className="sponsor-action">
                    {(row.action === 'draft' || row.action === 'retry') && (
                      <Button onClick={() => setSending(s)}>
                        {row.action === 'draft' ? 'Draft invoice' : 'Retry send'}
                      </Button>
                    )}
                    {row.action === 'share' && <ShareReportButton sponsor={s} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sending && (
        <SendInvoiceDialog sponsor={sending} eventId={event.id} onClose={() => setSending(null)} onSent={refresh} />
      )}
    </section>
  );
}
