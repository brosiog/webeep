import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectNewMessages } from '../public/notify.js';

const first = { id: 'a', timestamp: '2026-09-20T12:00:00.000Z' };
const second = { id: 'b', timestamp: '2026-09-20T12:01:00.000Z' };
const third = { id: 'c', timestamp: '2026-09-20T12:02:00.000Z' };

test('empty threads select nothing', () => {
  assert.deepEqual(selectNewMessages([], 'a'), { fresh: [], latestId: 'a' });
  assert.deepEqual(selectNewMessages([], null), { fresh: [], latestId: null });
});

test('an unseen chat announces only its newest message', () => {
  assert.deepEqual(selectNewMessages([first, second, third], null), { fresh: [third], latestId: 'c' });
  assert.deepEqual(selectNewMessages([third, first, second], undefined), { fresh: [third], latestId: 'c' });
});

test('a known chat selects only what arrived after the baseline', () => {
  assert.deepEqual(selectNewMessages([first, second, third], 'a'), { fresh: [second, third], latestId: 'c' });
  assert.deepEqual(selectNewMessages([first, second, third], 'c'), { fresh: [], latestId: 'c' });
});

test('unknown gaps resync the baseline without replaying history', () => {
  assert.deepEqual(selectNewMessages([second, third], 'missing'), { fresh: [], latestId: 'c' });
});
