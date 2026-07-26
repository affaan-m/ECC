import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, useClerk } from '@clerk/clerk-react';
import { CLERK_ENABLED } from '../data/clerkConfig.js';
import { backendConfigured, acceptCalendarInvite } from '../data/api.js';

// Where an invite link (see SharedCalendarDetailPage's "Create invite")
// lands. No Pro gate here deliberately — the invited person may not be a
// Pro subscriber themselves, but should still be able to accept and see a
// calendar someone shared with them.
export default function SharedCalendarJoinPage() {
  if (!CLERK_ENABLED || !backendConfigured()) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Join calendar</h1>
        </header>
        <p className="muted center-pad">
          This link needs Keystone's account system connected to a live server, which this build
          doesn't have set up yet.
        </p>
      </div>
    );
  }
  return <SharedCalendarJoinInner />;
}

function SharedCalendarJoinInner() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isSignedIn, getToken } = useAuth();
  const clerk = useClerk();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isSignedIn) return;
    acceptCalendarInvite(getToken, token)
      .then(({ calendarId }) => navigate(`/shared-calendars/${calendarId}`, { replace: true }))
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Join calendar</h1>
      </header>
      {!isSignedIn ? (
        <div className="empty">
          <p className="muted">Sign in to accept this invite.</p>
          <button className="btn btn-primary" onClick={() => clerk.openSignIn()}>
            Sign in
          </button>
        </div>
      ) : error ? (
        <p className="muted center-pad">{error}</p>
      ) : (
        <p className="muted center-pad">Joining…</p>
      )}
    </div>
  );
}
