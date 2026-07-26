import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useStore, useActions } from '../data/store.jsx';
import EditorSheet from '../components/EditorSheet.jsx';
import Select from '../components/Select.jsx';
import { todayISO } from '../data/helpers.js';
import { confirmTick, selectTick } from '../data/haptics.js';
import { geocodeAddress } from '../data/geocode.js';

const LONG_PRESS_MS = 500;
const LONG_PRESS_TOLERANCE_PX = 18; // generous — real fingers drift more than a mouse

const QUICK_EMOJI = ['📍', '🏠', '💼', '☕', '🍽️', '🏋️', '🛒', '🏥', '🎓', '⛪', '🌳', '❤️', '⭐', '🎉'];
const DEFAULT_VIEW = [37.7749, -122.4194];

const escapeHtml = (s = '') =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default function MapPage() {
  const { state } = useStore();
  const actions = useActions();
  const showContactPins = state.settings?.mapShowContactPins ?? true;
  const showCustomPins = state.settings?.mapShowCustomPins ?? true;
  const emojiSizePct = state.settings?.mapEmojiSize ?? 100;
  const pins = (state.pins || []).filter((p) =>
    p.contactId ? showContactPins : showCustomPins
  );

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const tempLayerRef = useRef(null);
  const pickLayerRef = useRef(null);
  const pinsRef = useRef(pins);
  const handlersRef = useRef({});
  const pressRef = useRef(null); // { timer, startPoint, latlng, fired }
  const suppressClickRef = useRef(false); // true right after a long-press fires

  const location = useLocation();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [pendingContact, setPendingContact] = useState('');
  const [editing, setEditing] = useState(null);
  const [initialEditingJson, setInitialEditingJson] = useState('');
  const wasEditingRef = useRef(false);
  if (editing && !wasEditingRef.current) {
    wasEditingRef.current = true;
    setInitialEditingJson(JSON.stringify(editing));
  } else if (!editing && wasEditingRef.current) {
    wasEditingRef.current = false;
  }
  const [tempPin, setTempPin] = useState(null); // { lat, lng, x, y } from a long-press

  // "Select location" picking flow, entered from the event editor.
  const [pickMode, setPickMode] = useState(false);
  const [pickReturnTo, setPickReturnTo] = useState('/planner');
  const [pickLatLng, setPickLatLng] = useState(null);
  const [pickQuery, setPickQuery] = useState('');
  const [pickSearching, setPickSearching] = useState(false);

  const selected = pins.find((p) => p.id === selectedId) || null;
  pinsRef.current = pins;

  // Keep the map click handler pointing at fresh state each render.
  handlersRef.current.onMapClick = (e) => {
    // Leaflet fires a synthetic "click" right after the mouseup that ends a
    // long-press — swallow that one click so it doesn't instantly clear the
    // temp pin we just dropped.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (pickMode) {
      setPickLatLng({ lat: e.latlng.lat, lng: e.latlng.lng });
      selectTick();
      return;
    }
    if (placing) {
      setPlacing(false);
      setEditing({
        emoji: '📍',
        label: '',
        notes: '',
        lat: e.latlng.lat,
        lng: e.latlng.lng,
        contactId: pendingContact || '',
        arriveRadius: 0,
      });
      setPendingContact('');
    } else {
      setSelectedId(null);
      setTempPin(null);
    }
  };

  // Long-press anywhere on the map drops a temporary pin with a quick choice
  // of saving it permanently or just getting directions — a faster path than
  // the explicit "+" placement flow below.
  //
  // This listens on the raw DOM element with native Pointer Events instead of
  // going through Leaflet's map.on('mousedown'/...) — Leaflet's synthetic
  // mouse events aren't reliably dispatched for real touch input on every
  // browser/version, which was silently breaking this on phones even though
  // it worked fine under simulated mouse events. Pointer Events unify mouse,
  // touch, and pen and are what Leaflet itself prefers internally when
  // available, so listening directly avoids that translation layer entirely.
  const clearPressTimer = () => {
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };
  handlersRef.current.onPressStart = (e) => {
    if (placing || pickMode || !mapRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // ignore right/middle click
    clearPressTimer();
    suppressClickRef.current = false;
    const startPoint = { x: e.clientX, y: e.clientY };
    const latlng = mapRef.current.mouseEventToLatLng(e);
    pressRef.current = {
      startPoint,
      fired: false,
      timer: setTimeout(() => {
        if (!pressRef.current) return;
        pressRef.current.fired = true;
        suppressClickRef.current = true;
        setSelectedId(null);
        setTempPin({ lat: latlng.lat, lng: latlng.lng, x: startPoint.x, y: startPoint.y });
        // Not confirmTick() here directly: this callback runs off a
        // setTimeout, and Chrome silently drops navigator.vibrate() calls
        // that aren't tied closely enough to a real user gesture. Flag it
        // and fire from the next actual pointer event instead.
        pressRef.current.pendingArmTick = true;
      }, LONG_PRESS_MS),
    };
  };
  handlersRef.current.onPressMove = (e) => {
    const p = pressRef.current;
    if (!p) return;
    if (p.pendingArmTick) {
      p.pendingArmTick = false;
      confirmTick();
    }
    if (p.fired) return;
    const dx = e.clientX - p.startPoint.x;
    const dy = e.clientY - p.startPoint.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_TOLERANCE_PX) clearPressTimer();
  };
  handlersRef.current.onPressEnd = () => {
    // Fallback for a held-perfectly-still long-press: if no pointermove
    // followed to fire the pending arm tick, this release is itself a real
    // event to fire it from instead of losing it.
    if (pressRef.current?.pendingArmTick) {
      pressRef.current.pendingArmTick = false;
      confirmTick();
    }
    if (!pressRef.current?.fired) clearPressTimer();
    else pressRef.current = null;
  };

  // Honor navigation intent from a contact's page (add-a-place / view-a-pin)
  // or an event editor asking to pick a location on the full map.
  useEffect(() => {
    const st = location.state;
    if (!st) return;
    if (st.placeForContact) {
      setPendingContact(st.placeForContact);
      setPlacing(true);
    }
    if (st.selectPin) setSelectedId(st.selectPin);
    if (st.picking) {
      setPickMode(true);
      setPickReturnTo(st.returnTo || '/planner');
      if (st.initialLat != null && st.initialLng != null) {
        setPickLatLng({ lat: st.initialLat, lng: st.initialLng });
      }
    }
    window.history.replaceState({}, ''); // consume so it doesn't retrigger
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Center on the initial pick location once the map exists.
  useEffect(() => {
    if (pickMode && pickLatLng && mapRef.current) {
      mapRef.current.setView([pickLatLng.lat, pickLatLng.lng], 15);
    }
  }, [pickMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialise the Leaflet map once.
  useEffect(() => {
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const initial = pinsRef.current;
    if (initial.length === 1) {
      map.setView([initial[0].lat, initial[0].lng], 14);
    } else if (initial.length > 1) {
      map.fitBounds(L.latLngBounds(initial.map((p) => [p.lat, p.lng])).pad(0.3));
    } else {
      map.setView(DEFAULT_VIEW, 12);
    }

    layerRef.current = L.layerGroup().addTo(map);
    tempLayerRef.current = L.layerGroup().addTo(map);
    pickLayerRef.current = L.layerGroup().addTo(map);
    map.on('click', (e) => handlersRef.current.onMapClick?.(e));
    // Leaflet's own drag/zoom gestures starting is a reliable extra signal
    // that this was a pan, not a hold — cancel our timer either way.
    map.on('dragstart zoomstart', () => handlersRef.current.onPressEnd?.());
    mapRef.current = map;

    // Native Pointer Events directly on the DOM element (see note above the
    // handler definitions) — passive since we never call preventDefault.
    const el = containerRef.current;
    const onDown = (e) => handlersRef.current.onPressStart?.(e);
    const onMove = (e) => handlersRef.current.onPressMove?.(e);
    const onUp = () => handlersRef.current.onPressEnd?.();
    el.addEventListener('pointerdown', onDown, { passive: true });
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerup', onUp, { passive: true });
    el.addEventListener('pointercancel', onUp, { passive: true });

    // Leaflet needs a nudge once the tab's layout settles.
    setTimeout(() => map.invalidateSize(), 120);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Render / re-render pin markers whenever pins or the selection change.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const grow = emojiSizePct / 100;
    for (const p of pins) {
      const sel = p.id === selectedId;
      const icon = L.divIcon({
        className: `pin-icon${sel ? ' pin-icon--sel' : ''}`,
        html:
          `<div style="--emoji-size:${emojiSizePct}">` +
          `<div class="pin-bubble"><span>${escapeHtml(p.emoji || '📍')}</span></div>` +
          (p.label ? `<div class="pin-caption">${escapeHtml(p.label)}</div>` : '') +
          `</div>`,
        iconSize: [40 * grow, 46 * grow],
        iconAnchor: [20 * grow, 46 * grow],
      });
      L.marker([p.lat, p.lng], { icon, keyboard: false })
        .addTo(layer)
        .on('click', () => {
          if (pickMode) return;
          setSelectedId(p.id);
        });
    }
  }, [pins, selectedId, emojiSizePct, pickMode]);

  // Render the temporary long-press marker (a dashed, pulsing pin distinct
  // from saved pins) whenever it changes.
  useEffect(() => {
    const layer = tempLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!tempPin) return;
    const icon = L.divIcon({
      className: 'pin-icon pin-icon--temp',
      html: `<div class="pin-bubble pin-bubble--temp"><span>📍</span></div>`,
      iconSize: [40, 46],
      iconAnchor: [20, 46],
    });
    L.marker([tempPin.lat, tempPin.lng], { icon, keyboard: false }).addTo(layer);
  }, [tempPin]);

  // Render the draggable "select location" marker while picking.
  useEffect(() => {
    const layer = pickLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!pickMode || !pickLatLng) return;
    const icon = L.divIcon({
      className: 'pin-icon pin-icon--pick',
      html: `<div class="pin-bubble pin-bubble--pick"><span>📍</span></div>`,
      iconSize: [40, 46],
      iconAnchor: [20, 46],
    });
    L.marker([pickLatLng.lat, pickLatLng.lng], { icon, keyboard: false, draggable: true })
      .addTo(layer)
      .on('dragend', (e) => {
        const ll = e.target.getLatLng();
        setPickLatLng({ lat: ll.lat, lng: ll.lng });
        selectTick();
      });
  }, [pickMode, pickLatLng]);

  // Pan to the selected pin so it isn't hidden behind the info card.
  useEffect(() => {
    if (selected && mapRef.current) {
      mapRef.current.panTo([selected.lat, selected.lng], { animate: true });
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const locateMe = () => {
    if (!navigator.geolocation) return alert('Location is not available in this browser.');
    navigator.geolocation.getCurrentPosition(
      (pos) => mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 15),
      () => alert('Could not get your location. Check your browser permissions.')
    );
  };

  const directionsTo = (p) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    window.open(url, '_blank', 'noopener');
  };

  const savePin = () => {
    const payload = {
      emoji: (editing.emoji || '').trim(),
      label: editing.label.trim(),
      notes: editing.notes.trim(),
      lat: editing.lat,
      lng: editing.lng,
      contactId: editing.contactId || '',
      arriveRadius: Number(editing.arriveRadius) || 0,
    };
    if (editing.id) {
      actions.updatePin({ ...editing, ...payload });
      setSelectedId(editing.id);
    } else {
      actions.addPin({ ...payload, createdAt: todayISO() });
    }
    setEditing(null);
  };

  const contactName = (cid) => state.contacts.find((c) => c.id === cid)?.name;

  const searchPickLocation = async () => {
    const q = pickQuery.trim();
    if (!q || pickSearching) return;
    setPickSearching(true);
    const hit = await geocodeAddress(q);
    setPickSearching(false);
    if (!hit) return alert("Couldn't find that address.");
    setPickLatLng(hit);
    mapRef.current?.setView([hit.lat, hit.lng], 16);
    selectTick();
  };
  const cancelPick = () => navigate(pickReturnTo, { state: { eventDraftReturn: true } });
  const confirmPick = () => {
    if (!pickLatLng) return;
    navigate(pickReturnTo, { state: { eventDraftReturn: true, locationPicked: pickLatLng } });
  };

  return (
    <div className="map-page">
      <div ref={containerRef} className="map-canvas" />

      {/* Corner controls (top-right) */}
      {!pickMode && (
        <div className="map-corner">
          <button className="map-round" onClick={locateMe} aria-label="My location" title="My location">
            <LocateIcon />
          </button>
          {selected && (
            <button
              className="map-round map-round--go"
              onClick={() => directionsTo(selected)}
              aria-label="Get directions"
              title="Get directions"
            >
              <NavIcon />
            </button>
          )}
        </div>
      )}

      {/* Location-picking flow, entered from the event editor */}
      {pickMode && (
        <>
          <div className="map-banner map-pick-banner">
            <input
              className="map-pick-search"
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchPickLocation()}
              placeholder="Search for an address…"
            />
            <button
              className="map-round map-pick-search-btn"
              onClick={searchPickLocation}
              disabled={pickSearching}
              aria-label="Search"
              title="Search"
            >
              <SearchIcon />
            </button>
            <button className="banner-x" onClick={cancelPick} aria-label="Cancel">
              ✕
            </button>
          </div>
          <div className="map-pick-footer">
            <p className="muted small center-pad">
              {pickLatLng ? 'Drag the pin, or tap elsewhere to move it.' : 'Tap the map to drop a pin, or search above.'}
            </p>
            <button className="btn btn-primary full" disabled={!pickLatLng} onClick={confirmPick}>
              Use this location
            </button>
          </div>
        </>
      )}

      {/* Placement banner */}
      {!pickMode && placing && (
        <div className="map-banner">
          {pendingContact && contactName(pendingContact)
            ? `Tap the map to place ${contactName(pendingContact).split(' ')[0]}'s spot`
            : 'Tap the map to drop your pin'}
          <button
            className="banner-x"
            onClick={() => {
              setPlacing(false);
              setPendingContact('');
            }}
            aria-label="Cancel"
          >
            ✕
          </button>
        </div>
      )}

      {/* Temporary long-press pin: a small floating bubble near the tap point */}
      {!pickMode && tempPin && !selected && (
        <div
          className="temp-pin-bubble"
          style={{
            left: Math.min(Math.max(tempPin.x, 90), window.innerWidth - 90),
            top: Math.max(tempPin.y - 74, 64),
          }}
        >
          {/* The long-press that dropped this pin already fired its own arm
              tick; these three quick-choice buttons appear as its immediate,
              same-gesture follow-up, right where the finger just was — a
              second tick that close behind the first read as a double-buzz
              bug rather than two distinct actions, so they stay silent. */}
          <button
            className="temp-pin-action"
            data-haptic="none"
            onClick={() => directionsTo(tempPin)}
            aria-label="Get directions"
            title="Directions"
          >
            <NavIcon />
          </button>
          <button
            className="temp-pin-action"
            data-haptic="none"
            onClick={() => {
              setEditing({ emoji: '📍', label: '', notes: '', lat: tempPin.lat, lng: tempPin.lng, contactId: '', arriveRadius: 0 });
              setTempPin(null);
            }}
            aria-label="Save as pin"
            title="Save as pin"
          >
            📌
          </button>
          <button
            className="temp-pin-action temp-pin-action--x"
            data-haptic="none"
            onClick={() => setTempPin(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Add-pin button */}
      {!pickMode && !placing && !selected && !tempPin && (
        <button className="fab map-fab" onClick={() => { setSelectedId(null); setPlacing(true); }} aria-label="Add pin">
          +
        </button>
      )}

      {/* Selected pin card */}
      {!pickMode && selected && (
        <div className="pin-card">
          <div className="pin-card-head">
            <span className="pin-card-emoji">{selected.emoji || '📍'}</span>
            <div className="pin-card-title">
              <strong>{selected.label || 'Dropped pin'}</strong>
              {selected.contactId && contactName(selected.contactId) && (
                <Link className="pin-card-contact" to={`/contacts/${selected.contactId}`}>
                  {contactName(selected.contactId)}
                </Link>
              )}
            </div>
            <button className="icon-btn" onClick={() => setSelectedId(null)} aria-label="Close">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {selected.notes && <p className="pin-card-notes">{selected.notes}</p>}
          <div className="pin-card-actions">
            <button className="btn btn-primary btn-sm" onClick={() => directionsTo(selected)}>
              ➤ Directions
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setEditing({ ...selected })}
            >
              Edit
            </button>
            <button
              className="btn btn-danger-ghost btn-sm"
              onClick={() => {
                actions.deletePin(selected.id);
                setSelectedId(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Pin editor */}
      <EditorSheet
        open={!!editing}
        title={editing?.id ? 'Edit pin' : 'New pin'}
        dirty={editing ? JSON.stringify(editing) !== initialEditingJson : false}
        onSave={savePin}
        onDiscard={() => setEditing(null)}
      >
        {editing && (
          <div className="form">
            <div className="field">
              <span>Icon</span>
              <div className="emoji-grid">
                {QUICK_EMOJI.map((em) => (
                  <button
                    key={em}
                    className={`emoji-pick${editing.emoji === em ? ' emoji-pick--on' : ''}`}
                    onClick={() => setEditing({ ...editing, emoji: em })}
                  >
                    {em}
                  </button>
                ))}
              </div>
              <input
                className="emoji-input"
                value={editing.emoji}
                onChange={(e) => setEditing({ ...editing, emoji: e.target.value })}
                placeholder="Or type any emoji"
                maxLength={4}
              />
            </div>
            <label className="field">
              <span>Label</span>
              <input
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                placeholder="e.g. Home, Gym, Sam's place"
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea
                rows="2"
                value={editing.notes}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                placeholder="Optional details"
              />
            </label>
            <label className="field">
              <span>Linked person</span>
              <Select
                value={editing.contactId || ''}
                onChange={(v) => setEditing({ ...editing, contactId: v })}
                placeholder="No one"
                options={[{ value: '', label: 'No one' }, ...state.contacts.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </label>
            <label className="field">
              <span>Arrival reminder</span>
              <Select
                value={String(editing.arriveRadius || 0)}
                onChange={(v) => setEditing({ ...editing, arriveRadius: Number(v) })}
                options={[
                  { value: '0', label: 'Off' },
                  { value: '100', label: 'Notify within 100m' },
                  { value: '250', label: 'Notify within 250m' },
                  { value: '500', label: 'Notify within 500m' },
                ]}
              />
            </label>
            {editing.arriveRadius > 0 && (
              <p className="muted small">
                Turn on Arrival reminders in More → Settings, and keep Keystone open, to get notified.
              </p>
            )}
            <p className="muted small">
              Location: {editing.lat.toFixed(5)}, {editing.lng.toFixed(5)}
            </p>
          </div>
        )}
      </EditorSheet>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-4.5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function LocateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function NavIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M3 11l18-8-8 18-2-8-8-2z" fill="currentColor" />
    </svg>
  );
}
