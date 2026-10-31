import { useSearchParams } from 'react-router-dom';
import { Landing } from '../landing/Landing';

const loginProblems: Record<string, string> = {
  error: "PayPal didn't sign you in. Try again.",
  denied: "Your PayPal account isn't allowed to use this event. Ask the treasurer to add you.",
};

// Sign in is the landing page: a signed-out visitor sees what the product is and two ways in. Log in with PayPal
// is a full-page redirect to PayPal and back (never a popup) and admits only allowlisted PayPal accounts;
// "Enter the demo" is for judges and the video, and only works where the server enables it.
export function SignIn() {
  const [params] = useSearchParams();
  return <Landing problem={loginProblems[params.get('login') ?? ''] ?? null} />;
}
