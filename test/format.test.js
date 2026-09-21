import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVATAR_GRADIENTS, avatarGradient, formatChatTime } from '../public/format.js';

test('avatar gradients are stable winter pastels', () => {
  assert.equal(avatarGradient('chat-1'), avatarGradient('chat-1'));
  assert.ok(AVATAR_GRADIENTS.map(([from, to]) => `linear-gradient(135deg, ${from}, ${to})`).includes(avatarGradient('chat-1')));
  assert.ok(AVATAR_GRADIENTS.map(([from, to]) => `linear-gradient(135deg, ${from}, ${to})`).includes(avatarGradient('')));
});

test('chat times compress to today, yesterday, or date', () => {
  const now = new Date('2026-09-21T15:00:00');
  assert.equal(formatChatTime('2026-09-21T15:03:00', now), new Date('2026-09-21T15:03:00').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  assert.equal(formatChatTime('2026-09-20T12:00:00', now), 'Yesterday');
  assert.equal(formatChatTime('2026-09-18T12:00:00', now), new Date('2026-09-18T12:00:00').toLocaleDateString());
  assert.equal(formatChatTime('', now), '');
  assert.equal(formatChatTime('not-a-date', now), '');
});
