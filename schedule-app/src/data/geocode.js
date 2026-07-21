// Client-side, key-free geocoding via OpenStreetMap's Nominatim. Best-effort:
// on any failure (offline, blocked, no results) resolves to null rather than
// throwing, since this drives a "nice to have" auto-pin, not a required save.
export async function geocodeAddress(query) {
  const q = query?.trim();
  if (!q) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const results = await res.json();
    const hit = results?.[0];
    if (!hit) return null;
    return { lat: Number(hit.lat), lng: Number(hit.lon) };
  } catch {
    return null;
  }
}

// Geocode a contact's address and create/update the one auto-managed map
// pin for them (tagged so we never touch a pin the user placed by hand).
export async function syncContactAddressPin(contact, state, actions) {
  const address = contact.address?.trim();
  const existing = (state.pins || []).find(
    (p) => p.contactId === contact.id && p.source === 'contact-address'
  );
  if (!address) {
    if (existing) actions.deletePin(existing.id);
    return;
  }
  const loc = await geocodeAddress(address);
  if (!loc) return;
  if (existing) {
    actions.updatePin({ ...existing, lat: loc.lat, lng: loc.lng, label: contact.name });
  } else {
    actions.addPin({
      emoji: '📍',
      label: contact.name,
      notes: '',
      lat: loc.lat,
      lng: loc.lng,
      contactId: contact.id,
      source: 'contact-address',
    });
  }
}
