import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useClerk } from '@clerk/clerk-react';
import { useStore } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import { CLERK_ENABLED } from '../data/clerkConfig.js';
import { backendConfigured, fetchCalendars, createCalendar } from '../data/api.js';

// Pro + backend feature: invite someone to see/add simple events with you
// on a calendar separate from your own private one (see backend/README.md
// "Known gaps" — the routes exist but nothing's been deployed/migrated yet,
// so this only shows the honest "not connected" state until that happens).
export default function SharedCalendarsPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const isPro = !!state.settings?.isPro;

  useEffect(() => {
    if (!isPro) navigate('/pricing', { replace: true });
  }, [isPro, navigate]);
  if (!isPro) return null;

  if (!CLERK_ENABLED || !backendConfigured()) {
    return (
      <div className="page">
        <header className="page-head">
          <button className="back-btn" onClick={() => navigate('/more')}>
            ‹ More
          </button>
          <h1>👥 Shared calendars</h1>
        </header>
        <p className="muted center-pad">
          Shared calendars need Keystone's account system connected to a live server, which this
          build doesn't have set up yet. The feature is ready to go once a backend is deployed.
        </p>
      </div>
    );
  }

  // Only mounted (so only calls Clerk's hooks) once ClerkProvider is
  // actually present — see main.jsx, which only renders it when
  // CLERK_ENABLED, same pattern MorePage's AccountSection uses.
  return <SharedCalendarsInner />;
}

function SharedCalendarsInner() {
  const navigate = useNavigate();
  const { isSignedIn, getToken } = useAuth();
  const clerk = useClerk();
  const [calendars, setCalendars] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(null); // { name } | null

  const load = async () => {
    setError('');
    try {
      const { calendars: list } = await fetchCalendars(getToken);
      setCalendars(list);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (isSignedIn) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const saveNew = async () => {
    const name = adding.name.trim();
    if (!name) return;
    try {
      await createCalendar(getToken, name);
      setAdding(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <button className="back-btn" onClick={() => navigate('/more')}>
            ‹ More
          </button>
          {isSignedIn && (
            <button className="btn btn-primary btn-sm" onClick={() => setAdding({ name: '' })}>
              + New
            </button>
          )}
        </div>
        <h1>👥 Shared calendars</h1>
      </header>

      {!isSignedIn ? (
        <div className="empty">
          <div className="empty-icon">👥</div>
          <h2>Sign in to get started</h2>
          <p className="muted">Create a calendar and invite someone to see or add events together.</p>
          <button className="btn btn-primary" onClick={() => clerk.openSignIn()}>
            Sign in
          </button>
        </div>
      ) : (
        <>
          {error && <p className="muted small center-pad">{error}</p>}
          {calendars === null ? (
            <p className="muted center-pad">Loading…</p>
          ) : calendars.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">👥</div>
              <h2>Share a calendar</h2>
              <p className="muted">Create one and invite someone to see or add events together.</p>
              <button className="btn btn-primary" onClick={() => setAdding({ name: '' })}>
                + New calendar
              </button>
            </div>
          ) : (
            <ul className="contact-list">
              {calendars.map((c) => (
                <li key={c.id}>
                  <button className="contact-row" onClick={() => navigate(`/shared-calendars/${c.id}`)}>
                    <span className="place-emoji">📅</span>
                    <span className="contact-main">
                      <span className="contact-name">{c.name}</span>
                      <span className="contact-sub muted">
                        {c.memberCount} {c.memberCount === 1 ? 'person' : 'people'} · {c.eventCount}{' '}
                        {c.eventCount === 1 ? 'event' : 'events'} · {c.role}
                      </span>
                    </span>
                    <Chevron />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <EditorSheet
        open={!!adding}
        title="New calendar"
        dirty={!!adding?.name.trim()}
        onSave={saveNew}
        onDiscard={() => setAdding(null)}
      >
        {adding && (
          <label className="field">
            <span>Name</span>
            <input
              autoFocus
              value={adding.name}
              onChange={(e) => setAdding({ name: e.target.value })}
              placeholder="e.g. Family calendar"
            />
          </label>
        )}
      </EditorSheet>
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="row-chevron">
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
