import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { TreasuryResponse, WalletStatus } from '@quartermaster/shared';
import { useFetch, type Fetched } from './api';

// What the sidebar and the screens must agree on. The wallet has one copy, so a revoke shows everywhere at
// once.
interface ShellData {
  wallet: Fetched<WalletStatus>;
  treasury: Fetched<TreasuryResponse>;
}

const noop = () => {};

const ShellDataContext = createContext<ShellData>({
  wallet: { kind: 'loading', reload: noop, refresh: noop },
  treasury: { kind: 'loading', reload: noop, refresh: noop },
});

export function ShellDataProvider({ children }: { children: ReactNode }) {
  const wallet = useFetch('/api/wallet', WalletStatus);
  const treasury = useFetch('/api/treasury', TreasuryResponse);
  const value = useMemo(
    () => ({ wallet, treasury }),
    [wallet, treasury],
  );
  return <ShellDataContext.Provider value={value}>{children}</ShellDataContext.Provider>;
}

export function useShellData(): ShellData {
  return useContext(ShellDataContext);
}
