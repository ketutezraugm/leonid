import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Field } from './Field';
import { PageState } from './PageState';

describe('Button', () => {
  it('is disabled and shows its busy label while busy', () => {
    render(
      <Button variant="primary" busy busyLabel="Saving…">
        Save event
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveClass('btn', 'btn-primary');
  });

  it('defaults to a secondary button that does not submit forms', () => {
    render(<Button>Cancel</Button>);
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('btn-secondary');
  });
});

describe('Field', () => {
  it('ties the label and hint to the input', () => {
    render(<Field id="people" label="Headcount" hint="Used to size catering." />);
    expect(screen.getByLabelText('Headcount')).toHaveAccessibleDescription(
      'Used to size catering.',
    );
  });

  it('marks the input invalid and announces the error instead of the hint', () => {
    render(
      <Field
        id="budget"
        label="Budget (USD)"
        hint="Whole dollars."
        error="Enter the budget as a number, for example 8000."
      />,
    );
    const input = screen.getByLabelText('Budget (USD)');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter the budget as a number, for example 8000.');
    expect(screen.queryByText('Whole dollars.')).not.toBeInTheDocument();
  });
});

describe('PageState', () => {
  it('announces errors and offers a retry', () => {
    const onRetry = vi.fn();
    render(
      <PageState kind="error" title="Couldn't load sponsor funding" onRetry={onRetry}>
        Check your connection, then try again.
      </PageState>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load sponsor funding");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
