import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useStore, useActions } from '../data/store.jsx';
import Modal from '../components/Modal.jsx';
import Logo from '../components/Logo.jsx';
import { todayISO } from '../data/helpers.js';

const QUICK_EMOJI = ['📍', '🏠', '💼', '☕', '🍽️', '🏋️', '🛒', '🏥', '🎓', '⛪', '🌳', '❤️', '⭐', '🎉'];
const DEFAULT_VIEW = [37.7749, -122.4194];

const escapeHtml = (s = '') =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default function MapPage() {
  const { state } = useStore();
  const actions = useActions();
  const pins = state.pins || [];

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const pinsRef = useRef(pins);
  const handlersRef = useRef({});

  const location = useLocation();
  const [selectedId, setSelectedId] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [pendingContact, setPendingContact] = useState('');
  const [editing, setEditing] = useState(null);

  const selected = pins.find((p) => p.id === selectedId) || null;
  pinsRef.current = pins;

  // Keep the map click handler pointing at fresh state each render.
  handlersRef.current.onMapClick = (e) => {
    if (placing) {
      setPlacing(false);
      setEditing({
        emoji: '📍',
        label: '',
        notes: '',
        lat: e.latlng.lat,
        lng: e.latlng.lng,
        contactId: pendingContact || '',
      });
      setPendingContact('');
    } else {
      setSelectedId(null);
    }
  };

  // Honor navigation intent from a contact's page (add-a-place / view-a-pin).
  useEffect(() => {
    const st = location.state;
    if (!st) return;
    if (st.placeForContact) {
      setPendingContact(st.placeForContact);
      setPlacing(true);
    }
    if (st.selectPin) setSelectedId(st.selectPin);
    window.history.replaceState({}, ''); // consume so it doesn't retrigger
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    map.on('click', (e) => handlersRef.current.onMapClick?.(e));
    mapRef.current = map;
    // Leaflet needs a nudge once the tab's layout settles.
    setTimeout(() => map.invalidateSize(), 120);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Render / re-render pin markers whenever pins or the selection change.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const p of pins) {
      const sel = p.id === selectedId;
      const icon = L.divIcon({
        className: `pin-icon${sel ? ' pin-icon--sel' : ''}`,
        html:
          `<div class="pin-bubble"><span>${escapeHtml(p.emoji || '📍')}</span></div>` +
          (p.label ? `<div class="pin-caption">${escapeHtml(p.label)}</div>` : ''),
        iconSize: [40, 46],
        iconAnchor: [20, 46],
      });
      L.marker([p.lat, p.lng], { icon, keyboard: false })
        .addTo(layer)
        .on('click', () => setSelectedId(p.id));
    }
  }, [pins, selectedId]);

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

  return (
    <div className="map-page">
      <div ref={containerRef} className="map-canvas" />

      <div className="map-logo">
        <Logo size={24} />
        <span>Map</span>
      </div>

      {/* Corner controls (top-right) */}
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

      {/* Placement banner */}
      {placing && (
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

      {/* Add-pin button */}
      {!placing && !selected && (
        <button className="fab map-fab" onClick={() => { setSelectedId(null); setPlacing(true); }} aria-label="Add pin">
          +
        </button>
      )}

      {/* Selected pin card */}
      {selected && (
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
      <Modal
        open={!!editing}
        title={editing?.id ? 'Edit pin' : 'New pin'}
        onClose={() => setEditing(null)}
        footer={
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={savePin}>
              Save
            </button>
          </div>
        }
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
              <select
                value={editing.contactId || ''}
                onChange={(e) => setEditing({ ...editing, contactId: e.target.value })}
              >
                <option value="">No one</option>
                {state.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              Location: {editing.lat.toFixed(5)}, {editing.lng.toFixed(5)}
            </p>
          </div>
        )}
      </Modal>
    </div>
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
