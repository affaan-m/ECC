import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../data/store.jsx';
import { isOverdue } from './ContactsPage.jsx';
import { optimizeRoute, formatDistance, buildGoogleMapsUrl } from '../data/routePlanner.js';
import { externalLinkProps } from '../data/maps.js';

export default function RoutePlannerPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const isPro = !!state.settings?.isPro;
  const reconnectDays = state.settings?.reconnectDays ?? 30;

  useEffect(() => {
    if (!isPro) navigate('/pricing', { replace: true });
  }, [isPro, navigate]);

  const pins = state.pins || [];
  const contactById = useMemo(
    () => Object.fromEntries(state.contacts.map((c) => [c.id, c])),
    [state.contacts]
  );

  const [selected, setSelected] = useState(() => {
    const initial = new Set();
    for (const p of pins) {
      const c = p.contactId && contactById[p.contactId];
      if (c && isOverdue(c, reconnectDays)) initial.add(p.id);
    }
    return initial;
  });
  const [myLocation, setMyLocation] = useState(null); // { lat, lng } | 'denied' | null
  const [route, setRoute] = useState(null); // { stops, totalMeters } | null

  const toggleSelected = (id) => {
    setRoute(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const findStart = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 8000 }
      );
    });

  const planRoute = async () => {
    const stops = pins.filter((p) => selected.has(p.id));
    if (stops.length === 0) return;
    const geo = myLocation && typeof myLocation === 'object' ? myLocation : await findStart();
    let start;
    let toVisit;
    let startedFromStop = null;
    if (geo) {
      setMyLocation(geo);
      start = geo;
      toVisit = stops;
    } else {
      // Without a known starting point, treat the first selected stop as
      // the start itself rather than routing "to" it with a nonsense 0m
      // leg — the order among the rest is still useful.
      setMyLocation('denied');
      startedFromStop = stops[0];
      start = startedFromStop;
      toVisit = stops.slice(1);
    }
    setRoute({ ...optimizeRoute(start, toVisit), start, startedFromStop });
  };

  if (!isPro) return null;

  return (
    <div className="page">
      <header className="page-head">
        <button className="back-btn" onClick={() => navigate('/map')}>
          ‹ Map
        </button>
        <h1>🧭 Plan my day</h1>
        <p className="muted small">
          Pick who/where you want to visit today — overdue people are pre-selected — then get the
          shortest visiting order, worked out straight-line (not real road distance).
        </p>
      </header>

      {pins.length === 0 ? (
        <p className="muted center-pad">Drop some pins on the Map first, then come back here.</p>
      ) : (
        <>
          <section className="detail-section">
            <span className="detail-label">Stops ({selected.size} selected)</span>
            <ul className="place-list">
              {pins.map((p) => {
                const c = p.contactId && contactById[p.contactId];
                const over = c && isOverdue(c, reconnectDays);
                return (
                  <li key={p.id}>
                    <button
                      className={`place-row${selected.has(p.id) ? ' place-row--selected' : ''}`}
                      onClick={() => toggleSelected(p.id)}
                    >
                      <span className={`select-dot${selected.has(p.id) ? ' select-dot--on' : ''}`} />
                      <span className="place-emoji">{p.emoji || '📍'}</span>
                      <span className="place-label">
                        {p.label || 'Dropped pin'}
                        {c && ` · ${c.name}`}
                        {over && <span className="overdue-tag">Reconnect</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <button className="btn btn-primary full" onClick={planRoute} disabled={selected.size === 0}>
            Optimize route
          </button>

          {route && (
            <section className="detail-section">
              <div className="section-head">
                <span className="detail-label">Suggested order</span>
                <span className="muted small">{formatDistance(route.totalMeters)} total</span>
              </div>
              {route.startedFromStop ? (
                <p className="muted small">
                  Couldn't get your location — starting from {route.startedFromStop.emoji || '📍'}{' '}
                  {route.startedFromStop.label || 'Dropped pin'} instead.
                </p>
              ) : null}
              <ul className="route-list">
                {route.startedFromStop && (
                  <li className="route-stop">
                    <span className="route-stop-num">•</span>
                    <span className="route-stop-label">
                      {route.startedFromStop.emoji || '📍'} {route.startedFromStop.label || 'Dropped pin'}
                    </span>
                    <span className="muted small">start</span>
                  </li>
                )}
                {route.stops.map((s, i) => (
                  <li key={s.id} className="route-stop">
                    <span className="route-stop-num">{i + 1}</span>
                    <span className="route-stop-label">
                      {s.emoji || '📍'} {s.label || 'Dropped pin'}
                    </span>
                    <span className="muted small">+{formatDistance(s.legMeters)}</span>
                  </li>
                ))}
              </ul>
              <a
                className="btn btn-primary full"
                {...externalLinkProps(buildGoogleMapsUrl(route.start, route.stops))}
              >
                ➤ Open full route in Google Maps
              </a>
            </section>
          )}
        </>
      )}
    </div>
  );
}
