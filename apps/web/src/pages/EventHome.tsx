import { useEffect, useState } from 'react';
import { HealthResponse } from '@quartermaster/shared';
import { Workspace } from '../workspace/Workspace';

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
    <Workspace
      idle={
        <p className="muted canvas-idle-health">
          API: {health ? `${health.status} (${health.service})` : (error ?? 'checking…')}
        </p>
      }
    />
  );
}
