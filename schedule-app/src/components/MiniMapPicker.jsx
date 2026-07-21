import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEFAULT_VIEW = [37.7749, -122.4194];

// A small embedded, tap-to-place map for picking a one-off location inline
// in a form (e.g. an event's location) without leaving the sheet. Distinct
// from the full Map tab — this pin isn't saved to the Places list, it just
// records a lat/lng on whatever it's attached to.
export default function MiniMapPicker({ lat, lng, onPick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      tap: true,
    });
    map.setView(lat != null ? [lat, lng] : DEFAULT_VIEW, lat != null ? 15 : 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    map.on('click', (e) => onPickRef.current(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 60);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
    }
    if (lat != null && lng != null) {
      const icon = L.divIcon({
        className: 'pin-icon',
        html: `<div class="pin-bubble"><span>📍</span></div>`,
        iconSize: [40, 46],
        iconAnchor: [20, 46],
      });
      markerRef.current = L.marker([lat, lng], { icon, keyboard: false }).addTo(map);
      map.panTo([lat, lng]);
    }
  }, [lat, lng]);

  return <div ref={containerRef} className="mini-map-picker" />;
}
