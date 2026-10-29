import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';

// Rules are code, not prompts (invariant 1): the agent may draft a rule from plain English, but only the
// confirmed, structured version is enforced. The compiler is P1's; this screen is its frame until that lands.
export function Rules() {
  return (
    <section>
      <PageHeader title="Rules" description="Write a rule in plain English, then confirm the structured version." />
      <Card>
        <form onSubmit={(e) => e.preventDefault()} className="rule-input">
          <Field
            id="rule-text"
            label="New rule"
            placeholder="Nothing over $200 without my approval"
            disabled
            hint="The rule compiler from P1 turns this into a fixed rule you confirm."
          />
          <Button variant="primary" disabled>
            Compile
          </Button>
        </form>
      </Card>
      <PageState kind="empty" title="No rules yet">
        The agent will ask you for every purchase until you add rules. Each rule will show in your words on the left
        and its structured version on the right.
      </PageState>
    </section>
  );
}
