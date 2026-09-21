import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createClientMessageId } from '../public/client-message-id.js';

let app;
let baseUrl;
let sentMessages;

before(async () => {
  sentMessages = [];
  app = createApp({ service: {
    async listChats() { return [{ id: 'chat-1', title: 'Family', unreadCount: 2, preview: 'See you soon' }]; },
    async getUnreadCount() { return 2; },
    async listMessages(chatId, limit) { assert.equal(chatId, 'chat-1'); assert.equal(limit, 20); return [{ id: 'message-1', sender: 'Alex', text: 'Dinner at six?', timestamp: '2026-09-20T12:00:00Z' }]; },
    async search(query, limit) { assert.equal(query, 'dinner'); assert.equal(limit, 10); return [{ id: 'message-1', chatId: 'chat-1', chatTitle: 'Family', sender: 'Alex', text: 'Dinner at six?', timestamp: '2026-09-20T12:00:00Z' }]; },
    async sendText(input) { sentMessages.push(input); return { id: 'sent-1' }; },
  } });
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${app.port}`;
});
after(async () => app?.close());

test('health endpoint reports ready without exposing configuration', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'ok' });
});
test('chat listing returns the service chat projection', async () => {
  const response = await fetch(`${baseUrl}/api/chats`);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { items: [{ id: 'chat-1', title: 'Family', unreadCount: 2, preview: 'See you soon' }] });
});
test('unread endpoint returns only a numeric total', async () => {
  const response = await fetch(`${baseUrl}/api/unread-count`);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { total: 2 });
});
test('message listing returns a thread for a valid chat id', async () => {
  const response = await fetch(`${baseUrl}/api/chats/chat-1/messages?limit=20`);
  assert.equal(response.status, 200); assert.equal((await response.json()).items[0].id, 'message-1');
});
test('search returns matching message projections', async () => {
  const response = await fetch(`${baseUrl}/api/search?q=dinner&limit=10`);
  assert.equal(response.status, 200); assert.equal((await response.json()).items[0].chatTitle, 'Family');
});
test('text sending rejects an unconfirmed request before contacting Beeper', async () => {
  const response = await fetch(`${baseUrl}/api/chats/chat-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'See you soon', clientMessageId: 'send-0001', confirmed: false }) });
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'confirmation_required' }); assert.deepEqual(sentMessages, []);
});
test('confirmed text send is idempotent by chat and client message id', async () => {
  const request = () => fetch(`${baseUrl}/api/chats/chat-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ text: 'See you soon', clientMessageId: 'send-0002', confirmed: true }) });
  const [first, second] = await Promise.all([request(), request()]);
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  assert.deepEqual(await first.json(), { id: 'sent-1', status: 'sent' }); assert.deepEqual(await second.json(), { id: 'sent-1', status: 'sent' });
  assert.deepEqual(sentMessages, [{ chatId: 'chat-1', text: 'See you soon', clientMessageId: 'send-0002' }]);
});
test('text send validates content and idempotency key', async () => {
  const response = await fetch(`${baseUrl}/api/chats/chat-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: ' ', clientMessageId: 'short', confirmed: true }) });
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'invalid_request' });
});

test('client message identifiers fall back to random values when UUIDs are unavailable', () => {
  const id = createClientMessageId({
    getRandomValues(bytes) {
      bytes.forEach((_, index) => { bytes[index] = index; });
      return bytes;
    },
  });
  assert.equal(id, '000102030405060708090a0b0c0d0e0f');
  assert.match(id, /^[A-Za-z0-9_-]{8,128}$/);
});