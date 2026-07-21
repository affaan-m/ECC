import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useActions } from '../data/store.jsx';
import { Brand } from '../components/Logo.jsx';

const FEATURES = [
  { label: 'Goals, Planner, Map', free: true, pro: true },
  { label: 'People (contacts)', free: false, pro: true },
  { label: 'Color themes (8 schemes)', free: false, pro: true },
  { label: 'Shared / collaborative events', free: false, pro: true },
  { label: 'Google account sync', free: false, pro: true },
  { label: 'Import/export to other calendars', free: false, pro: true },
  { label: 'Cloud backup across devices', free: false, pro: true },
];

export default function PricingPage() {
  const { state } = useStore();
  const actions = useActions();
  const navigate = useNavigate();
  const isPro = !!state.settings?.isPro;
  const [plan, setPlan] = useState('annual');

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
        <h1>Stewardly Pro</h1>
        <p className="muted">Unlock People, sharing, sync, and more.</p>
      </section>

      <div className="seg seg--full">
        <button className={`seg-btn${plan === 'monthly' ? ' seg-btn--on' : ''}`} onClick={() => setPlan('monthly')}>
          Monthly — $4/mo
        </button>
        <button className={`seg-btn${plan === 'annual' ? ' seg-btn--on' : ''}`} onClick={() => setPlan('annual')}>
          Annual — $35/yr
        </button>
      </div>
      {plan === 'annual' && <p className="pricing-save muted small">Save $13/year vs. monthly.</p>}

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

      {isPro ? (
        <div className="detail-section pricing-active">
          <span>✓ You're on Stewardly Pro (demo mode)</span>
          <button className="btn btn-ghost full" onClick={() => actions.setSettings({ isPro: false })}>
            Turn off demo Pro
          </button>
        </div>
      ) : (
        <button className="btn btn-primary full pricing-cta" onClick={() => actions.setSettings({ isPro: true })}>
          Try Pro (demo) — {plan === 'monthly' ? '$4/mo' : '$35/yr'}
        </button>
      )}

      <p className="muted small center-pad pricing-disclaimer">
        This build has no payment processor connected yet, so "Try Pro" just flips a local demo
        flag to preview Pro features — it doesn't charge you anything. Real subscriptions need a
        backend (e.g. Stripe) wired up before this can take actual payments.
      </p>
    </div>
  );
}
