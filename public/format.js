/** True-winter pastel pairs: cool undertones only, no warm hues. */
export const AVATAR_GRADIENTS = [
  ['#b8deff', '#86bcf3'], // icy blue
  ['#ccd2ff', '#a3adf7'], // periwinkle
  ['#c2ecdc', '#86d3ba'], // cool mint
  ['#e0cdf7', '#bd9cec'], // ice lilac
  ['#f7c6da', '#eba3c6'], // cool rose
  ['#b0e4ec', '#79c6d8'], // frost
  ['#d0e4f7', '#9ac1e8'], // powder blue
  ['#d8d2f5', '#ada4ec'], // icy violet
];

function avatarIndex(id) {
  let hash = 0;
  for (const char of String(id ?? '')) {
    hash = (hash * 31 + char.codePointAt(0)) % AVATAR_GRADIENTS.length;
  }
  return (hash + AVATAR_GRADIENTS.length) % AVATAR_GRADIENTS.length;
}

/** Stable pastel gradient derived from any id string. */
export function avatarGradient(id) {
  const [from, to] = AVATAR_GRADIENTS[avatarIndex(id)];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Compact row timestamp: "3:03 PM", "Yesterday", or "9/20/2026". Empty when unknown. */
export function formatChatTime(timestamp, now = new Date()) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return '';
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay(date, now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString();
}
