/** Stable gradient hue (0-359) derived from any id string. */
export function avatarHue(id) {
  let hash = 0;
  for (const char of String(id ?? '')) {
    hash = (hash * 31 + char.codePointAt(0)) % 360;
  }
  return (hash + 360) % 360;
}

export function avatarGradient(id) {
  const hue = avatarHue(id);
  return `linear-gradient(135deg, hsl(${hue}, 72%, 58%), hsl(${(hue + 45) % 360}, 68%, 42%))`;
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
