import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ApprovalsResponse, WalletStatus } from '@quartermaster/shared';
import { useFetch, type Fetched } from './api';
import { useEvent, withEvent } from './event';

// What the sidebar and the screens must agree on. The wallet has one copy, so a revoke shows everywhere at
// once; the approvals count is re-read on every navigation and after each approval.
interface ShellData {
  wallet: Fetched<WalletStatus>;
  waiting: number;
  refreshApprovals: () => void;
}

const noop = () => {};

const ShellDataContext = createContext<ShellData>({
  wallet: { kind: 'loading', reload: noop, refresh: noop },
  waiting: 0,
  refreshApprovals: noop,
});

export function ShellDataProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const wallet = useFetch('/api/wallet', WalletStatus);
  const event = useEvent();
  // The count in the sidebar is the current event's queue.
  const approvals = useFetch(withEvent('/api/approvals', event), ApprovalsResponse, pathname);
  const waiting =
    approvals.kind === 'ready' ? approvals.data.approvals.filter((a) => a.status === 'pending').length : 0;
  const refreshApprovals = approvals.refresh;
  const value = useMemo(() => ({ wallet, waiting, refreshApprovals }), [wallet, waiting, refreshApprovals]);
  return <ShellDataContext.Provider value={value}>{children}</ShellDataContext.Provider>;
}

export function useShellData(): ShellData {
  return useContext(ShellDataContext);
}
