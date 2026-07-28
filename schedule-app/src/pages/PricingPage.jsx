import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useClerk } from '@clerk/clerk-react';
import { useStore, useActions } from '../data/store.jsx';
import { Brand } from '../components/Logo.jsx';
import { CLERK_ENABLED } from '../data/clerkConfig.js';
import { startCheckout, openBillingPortal, backendConfigured } from '../data/api.js';

// Pro is a one-time purchase. This is the only place the price is written
// on the client — it's display text, and Stripe's price (set by
// STRIPE_PRICE_ID_LIFETIME on the backend) is the one that actually charges.
// Change both together.
const PRO_PRICE = '$9.99';

const FEATURES = [
  { label: 'Goals, Planner, Map, People', free: true, pro: true },
  { label: 'Contact history timeline', free: false, pro: true },
  { label: 'People status groups', free: false, pro: true },
  { label: 'Day & week templates', free: false, pro: true },
  { label: 'Color themes (22, incl. pastels)', free: false, pro: true },
  { label: 'Shared / collaborative events', free: false, pro: true },
  { label: 'Google account sync', free: false, pro: true },
  { label: 'Import/export to other calendars', free: false, pro: true },
  { label: 'Cloud backup across devices', free: false, pro: true },
];

export default function PricingPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const isPro = !!state.settings?.isPro;

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <button className="back-btn" onClick={() => navigate(-1)}>
            ‹ Back
          </button>
          <Brand>Pro</Brand>
        </div>
      </header>

      <section className="pricing-hero">
        <div className="pricing-crown">👑</div>
        <h1>Keystone Pro</h1>
        <p className="muted">Unlock contact timelines, status groups, sharing, sync, and more.</p>
      </section>

      <div className="pricing-onetime">
        <span className="pricing-amount">{PRO_PRICE}</span>
        <span className="pricing-once">one time</span>
        <p className="muted small">
          Not a subscription. Pay once and Pro is yours for good, including everything added later.
        </p>
      </div>

      <section className="detail-section">
        <span className="detail-label">What's included</span>
        <table className="pricing-table">
          <thead>
            <tr>
              <th></th>
              <th>Free</th>
              <th>Pro</th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f.label}>
                <td>{f.label}</td>
                <td>{f.free ? '✓' : '—'}</td>
                <td className="pricing-pro-col">{f.pro ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {CLERK_ENABLED ? (
        <RealPricingCTA isPro={isPro} settings={state.settings} />
      ) : (
        <DemoPricingCTA isPro={isPro} />
      )}
    </div>
  );
}

// Real Stripe Checkout flow — used once Clerk is configured.
function RealPricingCTA({ isPro, settings }) {
  const { isSignedIn, getToken } = useAuth();
  const clerk = useClerk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Only someone who subscribed before Pro became a one-time purchase has a
  // subscription to manage. Everyone else has nothing recurring, so offering
  // them a billing portal would just be confusing.
  const hasLegacySubscription =
    !!settings?.subscriptionStatus && !settings?.isLifetime;

  const handleUpgrade = async () => {
    if (!isSignedIn) return clerk.openSignIn();
    if (!backendConfigured()) return setError('Billing isn’t connected yet.');
    setError('');
    setBusy(true);
    try {
      const { url } = await startCheckout(getToken);
      window.location.href = url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const handleManage = async () => {
    setError('');
    setBusy(true);
    try {
      const { url } = await openBillingPortal(getToken);
      window.location.href = url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <>
      {isPro ? (
        <div className="detail-section pricing-active">
          <span>✓ You own Keystone Pro</span>
          {hasLegacySubscription && (
            <>
              <p className="muted small">
                You're on the old monthly/annual plan. Pro is a one-time purchase now — cancel here
                and your access stays until the period you've already paid for ends.
              </p>
              <button className="btn btn-ghost full" onClick={handleManage} disabled={busy}>
                Manage billing
              </button>
            </>
          )}
        </div>
      ) : (
        <button className="btn btn-primary full pricing-cta" onClick={handleUpgrade} disabled={busy}>
          {isSignedIn ? `Unlock Pro — ${PRO_PRICE} once` : 'Sign in to unlock Pro'}
        </button>
      )}
      {error && <p className="muted small center-pad pricing-disclaimer">{error}</p>}
    </>
  );
}

// Local-only demo toggle — used until Clerk/Stripe env vars are configured,
// so Pro-gated UI stays reachable for local development and testing.
function DemoPricingCTA({ isPro }) {
  const actions = useActions();
  return (
    <>
      {isPro ? (
        <div className="detail-section pricing-active">
          <span>✓ You own Keystone Pro (demo mode)</span>
          <button className="btn btn-ghost full" onClick={() => actions.setSettings({ isPro: false })}>
            Turn off demo Pro
          </button>
        </div>
      ) : (
        <button className="btn btn-primary full pricing-cta" onClick={() => actions.setSettings({ isPro: true })}>
          Try Pro (demo) — {PRO_PRICE} once
        </button>
      )}
      <p className="muted small center-pad pricing-disclaimer">
        This build has no payment processor connected yet, so "Try Pro" just flips a local demo
        flag to preview Pro features — it doesn't charge you anything.
      </p>
    </>
  );
}
