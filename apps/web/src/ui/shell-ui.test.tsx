import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AgentButton } from './AgentButton';
import { BudgetBar, unlockedToSpend } from './BudgetBar';
import { claimStatusView } from './claimStatus';
import { ConfirmDialog } from './Dialog';
import { Drawer } from './Drawer';
import { TabPanel, Tabs } from './Tabs';
import { ToastProvider, useToast } from './Toast';

describe('unlockedToSpend', () => {
  it('is cleared income minus committed spend, never below zero', () => {
    expect(unlockedToSpend({ cleared: 300_000, committed: 186_000 })).toBe(114_000);
    expect(unlockedToSpend({ cleared: 100, committed: 500 })).toBe(0);
  });

  it('never counts invoiced or pledged money as spendable', () => {
    const figures = { currency: 'USD', cleared: 300_000, committed: 186_000, invoiced: 250_000, pledged: 250_000 };
    expect(unlockedToSpend(figures)).toBe(114_000);
    render(<BudgetBar figures={figures} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/Unlocked \$1,140\.00.*Invoiced, not paid \$2,500\.00/);
  });
});

describe('claimStatusView', () => {
  it('shows needs_review to volunteers as "Being checked"', () => {
    expect(claimStatusView.needs_review.label).toBe('Being checked');
    expect(claimStatusView.rejected.label).toBe('Declined');
  });
});

describe('AgentButton', () => {
  it('is a labelled toggle that reports whether the drawer is open', () => {
    const onClick = vi.fn();
    const { rerender } = render(<AgentButton open={false} onClick={onClick} controls="agent-drawer" />);
    const button = screen.getByRole('button', { name: 'Ask the agent' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<AgentButton open onClick={onClick} controls="agent-drawer" />);
    expect(screen.getByRole('button', { name: 'Close the agent' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Drawer', () => {
  it('closes on Escape and keeps its children mounted while closed', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Drawer id="d" open title="Ask the agent" onClose={onClose}>
        <p>chat</p>
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(
      <Drawer id="d" open={false} title="Ask the agent" onClose={onClose}>
        <p>chat</p>
      </Drawer>,
    );
    expect(screen.getByText('chat')).toBeInTheDocument();
    expect(document.getElementById('d')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Tabs', () => {
  function Harness() {
    const [tab, setTab] = useState('a');
    return (
      <>
        <Tabs
          label="Views"
          selected={tab}
          onSelect={setTab}
          items={[
            { id: 'a', label: 'First' },
            { id: 'b', label: 'Second' },
            { id: 'c', label: 'Third' },
          ]}
        />
        <TabPanel>{tab}</TabPanel>
      </>
    );
  }

  it('moves between tabs with the arrow keys and wraps around', () => {
    render(<Harness />);
    const first = screen.getByRole('tab', { name: 'First' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('b');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Second' }), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'First' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Third' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('ConfirmDialog', () => {
  it('starts on Cancel, names the action, and cancels on Escape', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog title="Revoke the agent wallet?" confirmLabel="Revoke agent wallet" danger onConfirm={onConfirm} onCancel={onCancel}>
        <p>The agent will no longer be able to pay for anything.</p>
      </ConfirmDialog>,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke agent wallet' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('cannot be dismissed while busy', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Decline?" confirmLabel="Decline" busy busyLabel="Declining…" onConfirm={() => {}} onCancel={onCancel}>
        <p>x</p>
      </ConfirmDialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Declining…' })).toBeDisabled();
  });
});

describe('Toast', () => {
  function Trigger() {
    const toast = useToast();
    return <button onClick={() => toast.success('Paid $420.00.')}>go</button>;
  }

  it('announces a toast politely', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('go'));
    expect(screen.getByRole('status')).toHaveTextContent('Paid $420.00.');
  });
});
