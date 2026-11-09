import { ClaimsResponse, ClaimView, CreateVolunteerResponse } from '@quartermaster/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { ClaimList } from '../claims/ClaimList';
import { ApiFailure, errorMessage, sendJson, useFetch } from '../shell/api';
import { useEvent, withEvent } from '../shell/event';
import { Button } from '../ui/Button';
import { CopyId } from '../ui/CopyId';
import { Field } from '../ui/Field';
import { parseMoneyInput } from '../ui/money';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';

// F16, the treasurer's side. Register a volunteer (their claims are only ever paid to the PayPal email given
// here) and hand them their link; every claim then shows here with what the rules engine decided. A claim the
// receipt reader was unsure of waits for the treasurer to confirm the amount, and that still goes through the
// rules engine.

// The volunteer's link as a QR code, so it can be opened on a phone straight from the screen (and on camera).
// The QR library loads only when a link is shown.
function LinkQr({ url, name }: { url: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import('qrcode')
      .then((qr) => qr.toDataURL(url, { margin: 1, width: 320 }))
      .then((data) => {
        if (live) setSrc(data);
      })
      .catch(() => {}); // the link itself is still there to copy
    return () => {
      live = false;
    };
  }, [url]);
  return src ? <img className="claim-qr" src={src} alt={`QR code for ${name}'s claim link`} /> : null;
}

function AddVolunteer({ eventId, onAdded }: { eventId: string | null; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await sendJson('/api/claims/volunteers', CreateVolunteerResponse, {
        ...(eventId ? { eventId } : {}),
        name: name.trim(),
        payoutEmail: email.trim(),
      });
      setLink({ name: made.volunteer.name, url: `${window.location.origin}/claim/${made.claimToken}` });
      setName('');
      setEmail('');
      onAdded();
    } catch (err) {
      setError(
        err instanceof ApiFailure && err.status === 422
          ? 'Enter a name and a valid PayPal email.'
          : 'The volunteer could not be added.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Add a volunteer">
      <h2 className="card-title">Add a volunteer</h2>
      <form className="claim-form" onSubmit={onSubmit}>
        <Field
          id="volunteer-name"
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
        />
        <Field
          id="volunteer-email"
          label="PayPal email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          hint="Their claims are paid only to this address."
          error={error ?? undefined}
        />
        <Button type="submit" variant="primary" busy={busy} busyLabel="Adding…">
          Add and get their link
        </Button>
      </form>
      {link && (
        <div className="claim-link" role="status">
          <span>
            Send this link to {link.name}. It is shown only once, and anyone who has it can claim as {link.name}.
          </span>
          <CopyId value={link.url} />
          <LinkQr url={link.url} name={link.name} />
        </div>
      )}
    </section>
  );
}

function Review({ claim, onDone }: { claim: ClaimView; onDone: () => void }) {
  const [amount, setAmount] = useState(claim.amount === null ? '' : (claim.amount / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    const minor = parseMoneyInput(amount);
    if (minor === null || minor <= 0) {
      setError('Enter the receipt total, for example 32.50.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/api/claims/${claim.id}/review`, ClaimView, { amount: minor });
      onDone();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'The claim could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="claim-review" onSubmit={confirm}>
      <Field
        id={`review-${claim.id}`}
        label="Receipt total"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={error ?? undefined}
      />
      <a className="btn btn-secondary" href={`/api/claims/${claim.id}/receipt`} target="_blank" rel="noreferrer">
        View receipt
      </a>
      <Button type="submit" variant="primary" busy={busy} busyLabel="Sending…">
        Confirm and check the rules
      </Button>
    </form>
  );
}

export function Claims() {
  const event = useEvent();
  const list = useFetch(withEvent('/api/claims', event), ClaimsResponse);

  return (
    <section>
      <PageHeader
        title="Claims"
        description="Volunteers snap a receipt and are paid back to PayPal. Every claim passes the same rules as any payout."
      />
      <AddVolunteer eventId={event.id} onAdded={list.refresh} />
      <section className="card" aria-label="Claims">
        <h2 className="card-title">Claims</h2>
        {list.kind === 'loading' && <PageState kind="loading" title="Loading claims…" />}
        {list.kind === 'error' && (
          <PageState kind="error" title={errorMessage(list.error).title} onRetry={list.reload}>
            {errorMessage(list.error).detail}
          </PageState>
        )}
        {list.kind === 'ready' &&
          (list.data.claims.length === 0 ? (
            <p className="muted">
              No claims yet.
              {list.data.volunteers.length === 0 ? ' Add a volunteer above and send them their link.' : ''}
            </p>
          ) : (
            <ClaimList
              claims={list.data.claims}
              showName
              action={(c) => (c.status === 'needs_review' ? <Review claim={c} onDone={list.refresh} /> : null)}
            />
          ))}
      </section>
    </section>
  );
}
