import { ApprovalsScreen } from '../approvals/ApprovalsScreen';
import { PageHeader } from '../ui/PageHeader';

export function Approvals() {
  return (
    <section>
      <PageHeader
        title="Approvals"
        description="Carts and claims waiting for the treasurer, with the agent's reasoning."
      />
      <ApprovalsScreen />
    </section>
  );
}
