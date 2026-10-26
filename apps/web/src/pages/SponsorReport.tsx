import { useParams } from 'react-router-dom';

export function SponsorReport() {
  const { sponsorId } = useParams();
  return (
    <section>
      <h1>Sponsor report</h1>
      <p>Itemized spend report for sponsor {sponsorId}.</p>
    </section>
  );
}
