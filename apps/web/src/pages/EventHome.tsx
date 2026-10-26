import { useEffect, useState } from 'react';
import { HealthResponse } from '@quartermaster/shared';

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
      <h1>Event home</h1>
      <p>Countdown, unlocked budget, alerts and agent chat go here.</p>
      <p className="muted">
        API: {health ? `${health.status} (${health.service})` : (error ?? 'checking…')}
      </p>
    </section>
  );
}
