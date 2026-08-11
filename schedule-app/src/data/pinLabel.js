// Naming for the temporary pins today's events drop on the map.
//
// Every event pin used to read "Event 📅", which is true and useless — a map
// with four identical calendar pins on it tells you nothing you didn't
// already know. These pick the most specific name and icon the event
// actually supports, and fall back quietly when there's nothing to go on.

// Matched against the event title first, then its kind (call/text/...),
// then the contact's tags. Ordered most-specific-first: "coffee shop" should
// be a coffee, not a shop, and "doctor's office" should be a doctor.
const EMOJI_RULES = [
  [/\b(coffee|cafe|café|espresso|latte|brunch)\b/i, '☕'],
  [/\b(lunch|dinner|breakfast|meal|restaurant|eat|food|pizza|bbq|barbecue)\b/i, '🍽️'],
  [/\b(doctor|dentist|dental|clinic|hospital|appt|appointment|checkup|check-up|therapy|physio)\b/i, '🩺'],
  [/\b(gym|workout|run|running|training|yoga|pilates|swim|fitness|climb)\b/i, '🏋️'],
  [/\b(church|service|worship|mass|chapel|temple|prayer|bible|study group)\b/i, '⛪'],
  [/\b(school|class|lecture|lesson|exam|tutor|homework|university|college)\b/i, '🎓'],
  [/\b(birthday|bday|party|celebration|anniversary)\b/i, '🎂'],
  [/\b(interview|meeting|standup|stand-up|sync|1:1|one-on-one|client|work|office|call)\b/i, '💼'],
  [/\b(flight|airport|train|travel|trip|drive|commute|station)\b/i, '✈️'],
  [/\b(shop|shopping|groceries|grocery|store|market|errand|pickup|pick up|pick-up)\b/i, '🛒'],
  [/\b(home|house|visit|drop by|drop-by|stop by)\b/i, '🏠'],
  [/\b(haircut|barber|salon|spa|nails)\b/i, '💈'],
  [/\b(bank|invoice|tax|finance|payment|billing)\b/i, '🏦'],
  [/\b(volunteer|serve|service project|outreach|charity)\b/i, '🤝'],
  [/\b(movie|concert|game|match|show|theatre|theater|museum)\b/i, '🎟️'],
];

// Only used when nothing more specific matched — a person-linked event with
// an unrecognisable title is still more usefully a person than a calendar.
const CONTACT_FALLBACK_EMOJI = '🧑';
const DEFAULT_EMOJI = '📅';

function matchEmoji(text) {
  if (!text) return '';
  for (const [pattern, emoji] of EMOJI_RULES) {
    if (pattern.test(text)) return emoji;
  }
  return '';
}

// Cheap containment check that doesn't fire on a shared surname fragment —
// "Ben" shouldn't count as already-present in "Bennett's wedding".
function mentions(haystack, needle) {
  if (!haystack || !needle) return false;
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack);
}

// The label and emoji for one event's pin.
//
//   { title: 'Coffee', contact: { name: 'Alex Rivera' } }  →  '☕ Alex Rivera · Coffee'
//   { title: 'Coffee with Alex Rivera', contact: {...} }   →  '☕ Coffee with Alex Rivera'
//   { title: '', contact: { name: 'Alex Rivera' } }        →  '🧑 Alex Rivera'
//   { title: 'Dentist' }                                   →  '🩺 Dentist'
export function eventPinIdentity(event, { contact, eventKind } = {}) {
  const title = (event?.title || '').trim();
  const name = (contact?.name || '').trim();
  const firstName = name.split(/\s+/)[0] || '';

  let label;
  if (name && title) {
    // Don't say the name twice. A title the user already wrote as "Coffee
    // with Alex" reads worse as "Alex · Coffee with Alex".
    label = mentions(title, name) || mentions(title, firstName) ? title : `${name} · ${title}`;
  } else {
    label = title || name || 'Event';
  }

  const emoji =
    matchEmoji(title) ||
    matchEmoji(eventKind) ||
    matchEmoji((contact?.tags || []).join(' ')) ||
    (name ? CONTACT_FALLBACK_EMOJI : '') ||
    DEFAULT_EMOJI;

  return { label, emoji };
}
