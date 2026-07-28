import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../data/store.jsx';
import { makeOverdueCheck } from '../data/reconnect.js';
import {
  optimizeRoute,
  formatDistance,
  formatMinutes,
  buildGoogleMapsUrl,
} from '../data/routePlanner.js';
import { mapsLinkProps, webTarget } from '../data/maps.js';
import { eventPinIdentity } from '../data/pinLabel.js';
import { todayISO, expandEventOnDay, formatTime } from '../data/helpers.js';

export default function RoutePlannerPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const isPro = !!state.settings?.isPro;

  useEffect(() => {
    if (!isPro) navigate('/pricing', { replace: true });
  }, [isPro, navigate]);

  const contactById = useMemo(
    () => Object.fromEntries(state.contacts.map((c) => [c.id, c])),
    [state.contacts]
  );
  const overdueCheck = useMemo(() => makeOverdueCheck(state), [state]);

  // Today's events that have a location of their own become stops too. Half
  // the reason to plan a route is the things already on the calendar, and
  // those were invisible here — you could only route between saved pins, so
  // an event at an address you'd picked on the map simply didn't count.
  //
  // Shaped like a pin so everything downstream (selection, optimiser, the
  // Google Maps link) treats them identically, with a synthetic id that
  // can't collide with a real pin's.
  const eventStops = useMemo(() => {
    const iso = todayISO();
    const typeById = Object.fromEntries((state.eventTypes || []).map((t) => [t.id, t]));
    return state.events
      .flatMap((e) => expandEventOnDay(e, iso))
      .filter((o) => typeof o.locLat === 'number' && typeof o.locLng === 'number')
      .map((o) => ({
        id: `event:${o.id}:${o.recDate || iso}`,
        ...eventPinIdentity(o, {
          contact: contactById[o.contactId],
          eventType: typeById[o.typeId],
        }),
        lat: o.locLat,
        lng: o.locLng,
        contactId: o.contactId || '',
        isEvent: true,
        start: o.start,
        // The optimiser needs the real length of an appointment, not a
        // guess — an hour-long meeting pushes everything after it back by
        // an hour.
        end: o.end,
      }))
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  }, [state.events, state.eventTypes, contactById]);

  const pins = useMemo(() => [...(state.pins || []), ...eventStops], [state.pins, eventStops]);

  const [selected, setSelected] = useState(() => {
    const initial = new Set();
    for (const p of pins) {
      const c = p.contactId && contactById[p.contactId];
      if (c && overdueCheck(c)) initial.add(p.id);
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
          shortest visiting order. Today's events with a location are listed too: those keep their
          booked time and their real length, and everything else is fitted around them. Distances
          and times are offline estimates from straight-line geometry, not turn-by-turn routing.
        </p>
      </header>

      {pins.length === 0 ? (
        <p className="muted center-pad">
          Nothing to route yet — drop some pins on the Map, or give today's events a location.
        </p>
      ) : (
        <>
          <section className="detail-section">
            <span className="detail-label">Stops ({selected.size} selected)</span>
            <ul className="place-list">
              {pins.map((p) => {
                const c = p.contactId && contactById[p.contactId];
                const over = c && overdueCheck(c);
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
                        {/* Event pins already name the person in their label. */}
                        {c && !(p.label || '').includes(c.name) && ` · ${c.name}`}
                        {p.isEvent && p.start && (
                          <span className="muted small"> · {formatTime(p.start)}</span>
                        )}
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
                <span className="muted small">
                  {formatDistance(route.totalMeters)} · done by {formatTime(route.endsAt)}
                </span>
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
                  <li key={s.id} className={`route-stop${s.late ? ' route-stop--late' : ''}`}>
                    <span className="route-stop-num">{i + 1}</span>
                    <span className="route-stop-label">
                      {s.emoji || '📍'} {s.label || 'Dropped pin'}
                      <span className="route-stop-times muted small">
                        Leave {formatTime(s.leaveAt)} · arrive {formatTime(s.arriveAt)} ·{' '}
                        {formatMinutes(s.visitMinutes)} there
                      </span>
                      {s.late ? (
                        <span className="route-stop-warn small">
                          {formatMinutes(s.lateBy)} late for {formatTime(s.start)}
                        </span>
                      ) : s.waitMinutes >= 5 ? (
                        <span className="route-stop-times muted small">
                          {formatMinutes(s.waitMinutes)} spare first
                        </span>
                      ) : null}
                    </span>
                    <span className="muted small">+{formatDistance(s.legMeters)}</span>
                  </li>
                ))}
              </ul>
              <a
                className="btn btn-primary full"
                {...mapsLinkProps(webTarget(buildGoogleMapsUrl(route.start, route.stops)))}
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
