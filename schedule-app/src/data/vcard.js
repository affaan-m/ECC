// Minimal vCard (.vcf) import — enough to read contacts exported by common
// address book apps (Google Contacts, Apple Contacts, Outlook). A .vcf file
// can hold multiple concatenated vCards; each becomes one contact record.

function unescapeText(s = '') {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// N is "Family;Given;Middle;Prefix;Suffix" — used only when FN is missing.
function nameFromN(val) {
  const [family, given, middle] = val.split(';').map((p) => unescapeText(p || '').trim());
  return [given, middle, family].filter(Boolean).join(' ');
}

// ADR is "PO Box;Extended;Street;Locality;Region;PostalCode;Country".
function addressFromADR(val) {
  return val
    .split(';')
    .map((p) => unescapeText(p || '').trim())
    .filter(Boolean)
    .join(', ');
}

export function parseVCard(text) {
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n/);
  const contacts = [];
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.toUpperCase() === 'BEGIN:VCARD') {
      cur = { name: '', phone: '', email: '', address: '', notes: '' };
    } else if (line.toUpperCase() === 'END:VCARD') {
      if (cur && cur.name) contacts.push(cur);
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).split(';')[0].toUpperCase();
      const val = line.slice(idx + 1);
      if (key === 'FN') cur.name = unescapeText(val);
      else if (key === 'N' && !cur.name) cur.name = nameFromN(val);
      else if (key === 'TEL' && !cur.phone) cur.phone = unescapeText(val);
      else if (key === 'EMAIL' && !cur.email) cur.email = unescapeText(val);
      else if (key === 'ADR' && !cur.address) cur.address = addressFromADR(val);
      else if (key === 'NOTE') cur.notes = cur.notes ? `${cur.notes}\n${unescapeText(val)}` : unescapeText(val);
    }
  }
  return contacts;
}
