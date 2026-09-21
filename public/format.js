/** Wallpaper blues: sky, ice, aqua, and deep-water pairs. */
export const AVATAR_GRADIENTS = [
  ['#b8deff', '#7fbcf5'], // icy blue
  ['#a8e0f5', '#6fb8ec'], // aqua mist
  ['#b0e4ec', '#79c6d8'], // frost cyan
  ['#9fd4f5', '#6aa9e8'], // spray
  ['#c2d9f5', '#8fb4ec'], // periwinkle blue
  ['#a3d9e8', '#6fb9d8'], // lagoon
  ['#8fd0f0', '#5aa8e0'], // vivid sky
  ['#b8e8f0', '#83c9e8'], // foam
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
