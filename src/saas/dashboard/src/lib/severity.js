export const SEV = {
  1: { label: 'SEV1', color: '#ef4444', bg: '#450a0a', badge: '#991b1b' },
  2: { label: 'SEV2', color: '#f97316', bg: '#431407', badge: '#9a3412' },
  3: { label: 'SEV3', color: '#eab308', bg: '#422006', badge: '#854d0e' },
  4: { label: 'SEV4', color: '#6b7280', bg: '#1f2937', badge: '#374151' },
};

export const STATUS_COLOR = {
  open:          '#ef4444',
  investigating: '#f97316',
  mitigating:    '#eab308',
  resolved:      '#22c55e',
};

export function sevInfo(level) {
  return SEV[level] || SEV[3];
}

export function fmtDuration(secs) {
  if (!secs) return '—';
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function fmtTimeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}
