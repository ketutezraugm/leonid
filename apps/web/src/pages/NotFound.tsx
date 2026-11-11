import { Link } from 'react-router-dom';
import { PageHeader } from '../ui/PageHeader';

export function NotFound() {
  return <PageHeader title="Page not found" description={<Link to="/events">Back to all events</Link>} />;
}
