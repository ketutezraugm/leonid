import { useEffect, useState } from 'react';
import {
  BudgetBurnResponse,
  DeliveryRiskResponse,
  FundingThermometerResponse,
  PayoutsLedgerResponse,
  RulesHealthResponse,
  type WidgetSource,
} from '@quartermaster/shared';
import { ApiFailure, getJson } from '../shell/api';
import { sampleCommandCenterData } from './sample-data';
import type { CommandCenterData } from './studio-data';

export type WidgetName = 'funding' | 'budget' | 'payouts' | 'rules' | 'delivery';

// Where a widget's numbers come from: our own ledger or audit log ('live'), rows the server says are made up
// until the real data exists ('sample'), or this browser's own sample because the server could not be asked
// ('offline').
export type Origin = WidgetSource | 'offline';

// Why the numbers are not the server's.
export type Problem = 'signed-out' | 'not-configured' | 'no-event' | 'unreachable' | 'bad-response';

export type CommandCenterState =
  | { status: 'loading' }
  | {
      status: 'ready';
      data: CommandCenterData;
      origins: Record<WidgetName, Origin>;
      problem: Problem | null;
    };

const OFFLINE: Record<WidgetName, Origin> = {
  funding: 'offline',
  budget: 'offline',
  payouts: 'offline',
  rules: 'offline',
  delivery: 'offline',
};

export function problemOf(err: unknown): Problem {
  if (err instanceof ApiFailure) {
    if (err.status === 401) return 'signed-out';
    if (err.status === 503) return 'not-configured';
    if (err.status === 404) return 'no-event';
    return 'unreachable';
  }
  // A response that is not in the shared shape is a server bug, not a missing connection.
  return err instanceof Error && err.name === 'ZodError' ? 'bad-response' : 'unreachable';
}

// Asks the five widget endpoints (treasurer-only, so a signed-in session) and parses each answer with its
// shared schema. All five or none: if any fails, the caller gets the failure, never a half-live page.
export async function loadCommandCenter(
  eventId?: string | null,
): Promise<{ data: CommandCenterData; origins: Record<WidgetName, Origin> }> {
  const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
  const get = <T>(path: string, parser: { parse(value: unknown): T }) =>
    getJson(`/api/widgets/${path}${query}`, parser);

  const [funding, budget, payouts, rules, delivery] = await Promise.all([
    get('funding', FundingThermometerResponse),
    get('budget-burn', BudgetBurnResponse),
    get('payouts', PayoutsLedgerResponse),
    get('rules-health', RulesHealthResponse),
    get('delivery-risk', DeliveryRiskResponse),
  ]);
  return {
    data: {
      funding: funding.data,
      budget: budget.data,
      payouts: payouts.data,
      rules: rules.data,
      delivery: delivery.data,
    },
    origins: {
      funding: funding.source,
      budget: budget.source,
      payouts: payouts.source,
      rules: rules.source,
      delivery: delivery.source,
    },
  };
}

// The command center's data. With no event id the server uses the seeded demo event. If the server cannot be
// asked, this falls back to the browser's own sample *as a whole*: sample sponsor ids would not match a live
// sponsor, so mixing the two would break the cross-filtering. The state says why, so the page can say so.
export function useCommandCenterData(eventId?: string | null): CommandCenterState {
  const [state, setState] = useState<CommandCenterState>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    loadCommandCenter(eventId).then(
      ({ data, origins }) => {
        if (live) setState({ status: 'ready', data, origins, problem: null });
      },
      (err: unknown) => {
        if (live) {
          setState({
            status: 'ready',
            data: sampleCommandCenterData,
            origins: OFFLINE,
            problem: problemOf(err),
          });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [eventId]);

  return state;
}
