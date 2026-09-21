import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avatarGradient, avatarHue, formatChatTime } from '../public/format.js';

test('avatar hues are stable and bounded', () => {
  assert.equal(avatarHue('chat-1'), avatarHue('chat-1'));
  assert.ok(avatarHue('chat-1') >= 0 && avatarHue('chat-1') < 360);
  assert.ok(avatarHue('') >= 0 && avatarHue('') < 360);
  assert.match(avatarGradient('chat-1'), /^linear-gradient\(135deg, hsl\(\d+, 72%, 58%\), hsl\(\d+, 68%, 42%\)\)$/);
});

test('chat times compress to today, yesterday, or date', () => {
  const now = new Date('2026-09-21T15:00:00');
  assert.equal(formatChatTime('2026-09-21T15:03:00', now), new Date('2026-09-21T15:03:00').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  assert.equal(formatChatTime('2026-09-20T12:00:00', now), 'Yesterday');
  assert.equal(formatChatTime('2026-09-18T12:00:00', now), new Date('2026-09-18T12:00:00').toLocaleDateString());
  assert.equal(formatChatTime('', now), '');
  assert.equal(formatChatTime('not-a-date', now), '');
});
