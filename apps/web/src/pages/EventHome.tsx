import { useEffect, useState } from 'react';
import { HealthResponse } from '@quartermaster/shared';
import { AgentChat } from '../chat/AgentChat';
import { PageHeader } from '../ui/PageHeader';

export function EventHome() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((json) => setHealth(HealthResponse.parse(json)))
      .catch((err: unknown) => setError(String(err)));
  }, []);

  return (
    <section>
      <PageHeader title="Event home" description="Countdown, unlocked budget and alerts go here." />
      <p className="muted">
        API: {health ? `${health.status} (${health.service})` : (error ?? 'checking…')}
      </p>
      <AgentChat />
    </section>
  );
}
