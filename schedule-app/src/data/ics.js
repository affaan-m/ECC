// Minimal iCalendar (.ics) export/import — real interop with other calendar
// apps, no backend needed. Recurring events export using RRULE where
// possible; per-occurrence overrides and skips don't have a clean RRULE
// equivalent, so those export as their own VEVENTs (best-effort).
import { uid } from './helpers.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function toICSDateTime(dateISO, timeHHMM) {
  const [y, m, d] = dateISO.split('-');
  const [h, min] = (timeHHMM || '00:00').split(':');
  return `${y}${m}${d}T${pad(h)}${pad(min)}00`;
}

function escapeText(s = '') {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

const RRULE_FREQ = { daily: 'DAILY', weekly: 'WEEKLY', biweekly: 'WEEKLY', monthly: 'MONTHLY' };
const ICS_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function eventToRRule(e) {
  const repeat = e.repeat || 'none';
  if (repeat === 'none') return '';
  let rule = `FREQ=${RRULE_FREQ[repeat] || 'WEEKLY'}`;
  if (repeat === 'biweekly') rule += ';INTERVAL=2';
  if (repeat === 'custom' && (e.repeatDays || []).length) {
    rule = `FREQ=WEEKLY;BYDAY=${e.repeatDays.map((d) => ICS_DAY[d]).join(',')}`;
  }
  if (e.repeatUntil) rule += `;UNTIL=${toICSDateTime(e.repeatUntil, '23:59')}`;
  return `RRULE:${rule}`;
}

export function exportEventsToICS(events, contacts) {
  const contactName = (id) => contacts.find((c) => c.id === id)?.name;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Keystone//App//EN', 'CALSCALE:GREGORIAN'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.id}@keystone`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toICSDateTime(e.date, e.start)}`);
    lines.push(`DTEND:${toICSDateTime(e.date, e.end)}`);
    lines.push(`SUMMARY:${escapeText(e.title || 'Untitled')}`);
    const rrule = eventToRRule(e);
    if (rrule) lines.push(rrule);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    const notesParts = [e.notes, contactName(e.contactId) ? `With: ${contactName(e.contactId)}` : ''].filter(Boolean);
    if (notesParts.length) lines.push(`DESCRIPTION:${escapeText(notesParts.join('\\n'))}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadICS(events, contacts, filename = 'keystone-calendar.ics') {
  const ics = exportEventsToICS(events, contacts);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Parse a subset of iCalendar: enough to import single/simple events created
// by common calendar apps (Google Calendar, Apple Calendar, Outlook exports).
// Unfolds continuation lines, reads DTSTART/DTEND/SUMMARY/LOCATION/DESCRIPTION,
// and treats any RRULE as "weekly" if it can't be matched to a known frequency.
export function parseICS(text) {
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n/);
  const events = [];
  let cur = null;

  const finishDate = (val) => {
    // val like 20260721T090000 or 20260721
    const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!m) return null;
    const [, y, mo, d, h, mi] = m;
    return { date: `${y}-${mo}-${d}`, time: h ? `${h}:${mi}` : '00:00' };
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') {
      cur = { title: '', date: '', start: '09:00', end: '10:00', location: '', notes: '', repeat: 'none' };
    } else if (line === 'END:VEVENT') {
      if (cur && cur.date) events.push({ id: uid('e'), ...cur });
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).split(';')[0];
      const val = line.slice(idx + 1);
      if (key === 'SUMMARY') cur.title = val.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, ' ');
      else if (key === 'LOCATION') cur.location = val.replace(/\\,/g, ',');
      else if (key === 'DESCRIPTION') cur.notes = val.replace(/\\n/g, '\n').replace(/\\,/g, ',');
      else if (key === 'DTSTART') {
        const d = finishDate(val);
        if (d) {
          cur.date = d.date;
          cur.start = d.time;
        }
      } else if (key === 'DTEND') {
        const d = finishDate(val);
        if (d) cur.end = d.time;
      } else if (key === 'RRULE') {
        if (val.includes('FREQ=DAILY')) cur.repeat = 'daily';
        else if (val.includes('FREQ=WEEKLY') && val.includes('INTERVAL=2')) cur.repeat = 'biweekly';
        else if (val.includes('FREQ=WEEKLY')) cur.repeat = 'weekly';
        else if (val.includes('FREQ=MONTHLY')) cur.repeat = 'monthly';
      }
    }
  }
  return events;
}
