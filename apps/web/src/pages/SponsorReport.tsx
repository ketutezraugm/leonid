import { useParams } from 'react-router-dom';
import { PageHeader } from '../ui/PageHeader';

export function SponsorReport() {
  const { sponsorId } = useParams();
  return (
    <section>
      <PageHeader
        title="Sponsor report"
        description={`Itemized spend report for sponsor ${sponsorId}.`}
      />
    </section>
  );
}
