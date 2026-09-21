import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createContactStore } from '../src/contacts.js';
import { createClientMessageId } from '../public/client-message-id.js';

let app;
let baseUrl;
let sentMessages;
let sentReactions;
let markedReads;
let contactsDir;

before(async () => {
  sentMessages = [];
  sentReactions = [];
  markedReads = [];
  contactsDir = await mkdtemp(join(tmpdir(), 'beeper-web-test-'));
  app = createApp({ service: {
    async listChats() { return [{ id: 'chat-1', title: 'Family', type: 'group', participantPhoneNumbers: ['+15550101111', '+15550102222'], unreadCount: 2, preview: 'See you soon' }, { id: 'chat-2', title: '+1 (555) 010-2048', type: 'single', unreadCount: 0, preview: 'Call me back' }]; },
    async getUnreadCount() { return 2; },
    async listMessages(chatId, limit) { assert.equal(chatId, 'chat-1'); assert.equal(limit, 20); return [{ id: 'message-1', sender: 'Alex', text: 'Dinner at six?', reactions: [{ key: '❤️', participant: 'Alex' }], attachments: [{ assetURL: 'mxc://beeper.example/photo', type: 'img', fileName: 'photo.jpg', mimeType: 'image/jpeg' }], timestamp: '2026-09-20T12:00:00Z' }]; },
    async search(query, limit) { assert.equal(query, 'dinner'); assert.equal(limit, 10); return [{ id: 'message-1', chatId: 'chat-1', chatTitle: '', sender: 'Alex', text: 'Dinner at six?', timestamp: '2026-09-20T12:00:00Z' }]; },
    async sendText(input) { sentMessages.push(input); return { id: 'sent-1' }; },
    async markRead(input) { markedReads.push(input); return input; },
    async sendReaction(input) { sentReactions.push({ reaction: input }); return input; },
    async removeReaction(input) { sentReactions.push({ unreact: input }); return input; },
    isAssetAllowed(url) { return url === 'mxc://beeper.example/photo' || url === 'file:///bridge/media/photo.jpg'; },
    async serveAsset() { return { ok: true, status: 200, headers: new Map([['content-type', 'image/jpeg']]), body: new Blob(['fake-bytes']).stream() }; },
  }, contacts: createContactStore({ filePath: join(contactsDir, 'contacts.json') }) });
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${app.port}`;
});
after(async () => { await app?.close(); await rm(contactsDir, { recursive: true, force: true }); });

test('health endpoint reports ready without exposing configuration', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'ok' });
});
test('chat listing returns the service chat projection', async () => {
  const response = await fetch(`${baseUrl}/api/chats`);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { items: [{ id: 'chat-1', title: 'Family', type: 'group', participantPhoneNumbers: ['+15550101111', '+15550102222'], unreadCount: 2, preview: 'See you soon' }, { id: 'chat-2', title: '+1 (555) 010-2048', type: 'single', unreadCount: 0, preview: 'Call me back' }] });
});
test('number contact history labels persist and are reflected in chats', async () => {
  const first = await fetch(`${baseUrl}/api/contacts`);
  assert.deepEqual(await first.json(), { items: [
    { id: '+15550101111', chatId: null, number: '+15550101111', name: '', preview: 'Family: See you soon', unreadCount: 2 },
    { id: '+15550102222', chatId: null, number: '+15550102222', name: '', preview: 'Family: See you soon', unreadCount: 2 },
    { id: '+15550102048', chatId: 'chat-2', number: '+15550102048', name: '', preview: 'Call me back', unreadCount: 0 },
  ] });
  const update = await fetch(`${baseUrl}/api/contacts/%2B15550102048`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sam' }) });
  assert.equal(update.status, 200); assert.deepEqual(await update.json(), { id: '+15550102048', chatId: 'chat-2', number: '+15550102048', name: 'Sam', preview: 'Call me back', unreadCount: 0 });
  const groupUpdate = await fetch(`${baseUrl}/api/contacts/%2B15550101111`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Alex' }) });
  assert.equal(groupUpdate.status, 200); assert.equal((await groupUpdate.json()).name, 'Alex');
  const chats = await fetch(`${baseUrl}/api/chats`);
  assert.equal((await chats.json()).items[1].title, 'Sam');
  const replacement = createApp({ service: {
    async listChats() { return [{ id: 'chat-3', title: '+1 555 010 2048', type: 'single', unreadCount: 0, preview: 'New activity' }]; },
    async getUnreadCount() { return 0; }, async listMessages() { return []; }, async search() { return []; }, async sendText() { return { id: 'sent-2' }; }, async sendReaction(input) { return input; }, async removeReaction(input) { return input; },
  }, contacts: createContactStore({ filePath: join(contactsDir, 'contacts.json') }) });
  await replacement.listen(0);
  const replacementUrl = `http://127.0.0.1:${replacement.port}`;
  try {
    const replacementChats = await fetch(`${replacementUrl}/api/chats`);
    assert.equal((await replacementChats.json()).items[0].title, 'Sam');
  } finally {
    await replacement.close();
  }
});
test('stored number labels remain available when a number is no longer in recent history', async () => {
  const store = createContactStore({ filePath: join(contactsDir, 'labels-outside-history.json') });
  await store.setLabel('+15550109999', 'Taylor');
  assert.deepEqual(await store.getLabels(), { '+15550109999': 'Taylor' });
});
test('legacy chat-keyed labels resolve to the number used in message bubbles', async () => {
  const store = createContactStore({ filePath: join(contactsDir, 'legacy-labels.json') });
  await store.setLabel('legacy-chat-id', 'Mau');
  const labels = await store.getLabelsForChats([{ id: 'legacy-chat-id', title: '+1 (956) 333-5203', preview: '', unreadCount: 0 }]);
  assert.equal(labels['+19563335203'], 'Mau');
});
test('unread endpoint returns only a numeric total', async () => {
  const response = await fetch(`${baseUrl}/api/unread-count`);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { total: 2 });
});
test('assets serve bridge-known URLs and refuse anything else', async () => {
  const mxc = await fetch(`${baseUrl}/api/assets?url=${encodeURIComponent('mxc://beeper.example/photo')}`);
  assert.equal(mxc.status, 200); assert.equal(await mxc.text(), 'fake-bytes');
  const file = await fetch(`${baseUrl}/api/assets?url=${encodeURIComponent('file:///bridge/media/photo.jpg')}`);
  assert.equal(file.status, 200); assert.equal(await file.text(), 'fake-bytes');
  const sneaky = await fetch(`${baseUrl}/api/assets?url=${encodeURIComponent('file:///etc/beeper-web.env')}`);
  assert.equal(sneaky.status, 404); assert.deepEqual(await sneaky.json(), { error: 'not_found' });
  const garbage = await fetch(`${baseUrl}/api/assets?url=${encodeURIComponent('https://evil.example/photo.jpg')}`);
  assert.equal(garbage.status, 400); assert.deepEqual(await garbage.json(), { error: 'invalid_request' });
});
test('opening a chat marks it read', async () => {
  const response = await fetch(`${baseUrl}/api/chats/chat-1/read`, { method: 'POST' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'read', chatId: 'chat-1' });
  assert.deepEqual(markedReads, [{ chatId: 'chat-1' }]);
});
test('message listing returns a thread for a valid chat id', async () => {
  const response = await fetch(`${baseUrl}/api/chats/chat-1/messages?limit=20`);
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).items[0], { id: 'message-1', sender: 'Alex', text: 'Dinner at six?', reactions: [{ key: '❤️', participant: 'Alex' }], attachments: [{ type: 'img', fileName: 'photo.jpg', mimeType: 'image/jpeg', url: '/api/assets?url=mxc%3A%2F%2Fbeeper.example%2Fphoto' }], timestamp: '2026-09-20T12:00:00Z' });
});
test('reactions can be added and removed on a message', async () => {
  const add = await fetch(`${baseUrl}/api/chats/chat-1/messages/message-1/reactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emoji: '👍' }) });
  assert.equal(add.status, 201); assert.deepEqual(await add.json(), { status: 'reacted', chatId: 'chat-1', messageId: 'message-1', emoji: '👍' });
  const remove = await fetch(`${baseUrl}/api/chats/chat-1/messages/message-1/reactions/${encodeURIComponent('👍')}`, { method: 'DELETE' });
  assert.equal(remove.status, 200); assert.deepEqual(await remove.json(), { status: 'removed', chatId: 'chat-1', messageId: 'message-1', emoji: '👍' });
  assert.deepEqual(sentReactions, [{ reaction: { chatId: 'chat-1', messageId: 'message-1', emoji: '👍' } }, { unreact: { chatId: 'chat-1', messageId: 'message-1', emoji: '👍' } }]);
});
test('reaction endpoints validate the emoji key', async () => {
  const empty = await fetch(`${baseUrl}/api/chats/chat-1/messages/message-1/reactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emoji: '   ' }) });
  assert.equal(empty.status, 400); assert.deepEqual(await empty.json(), { error: 'invalid_request' });
  const wrongType = await fetch(`${baseUrl}/api/chats/chat-1/messages/message-1/reactions`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '👍' });
  assert.equal(wrongType.status, 415);
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
test('attachment-only and captioned sends pass the attachment through', async () => {
  const attachment = { fileName: 'photo.jpg', mimeType: 'image/jpeg', data: 'aGVsbG8=' };
  const bare = await fetch(`${baseUrl}/api/chats/chat-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '', clientMessageId: 'attach-0001', confirmed: true, attachment }) });
  assert.equal(bare.status, 201); assert.deepEqual(await bare.json(), { id: 'sent-1', status: 'sent' });
  assert.deepEqual(sentMessages.find((entry) => entry.clientMessageId === 'attach-0001').attachment, attachment);
  const captioned = await fetch(`${baseUrl}/api/chats/chat-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Look at this', clientMessageId: 'attach-0002', confirmed: true, replyToMessageId: 'message-1', attachment }) });
  assert.equal(captioned.status, 201);
  assert.deepEqual(sentMessages.find((entry) => entry.clientMessageId === 'attach-0002'), { chatId: 'chat-1', text: 'Look at this', clientMessageId: 'attach-0002', replyToMessageId: 'message-1', attachment });
  const badMime = await fetch(`${baseUrl}/api/chats/chat-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '', clientMessageId: 'attach-0003', confirmed: true, attachment: { ...attachment, mimeType: 'not-a-mime' } }) });
  assert.equal(badMime.status, 400); assert.deepEqual(await badMime.json(), { error: 'invalid_request' });
  const badData = await fetch(`${baseUrl}/api/chats/chat-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '', clientMessageId: 'attach-0004', confirmed: true, attachment: { ...attachment, data: '***not-base64***' } }) });
  assert.equal(badData.status, 400); assert.deepEqual(await badData.json(), { error: 'invalid_request' });
});
test('text send validates content and idempotency key', async () => {
  const response = await fetch(`${baseUrl}/api/chats/chat-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: ' ', clientMessageId: 'short', confirmed: true }) });
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'invalid_request' });
});
test('text send supports replies and validates the reply target', async () => {
  const clientMessageId = 'reply-0001';
  const response = await fetch(`${baseUrl}/api/chats/chat-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'On my way', clientMessageId, confirmed: true, replyToMessageId: 'message-1' }) });
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { id: 'sent-1', status: 'sent' });
  assert.deepEqual(sentMessages.find((entry) => entry.clientMessageId === clientMessageId), { chatId: 'chat-1', text: 'On my way', clientMessageId, replyToMessageId: 'message-1' });
  const empty = await fetch(`${baseUrl}/api/chats/chat-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'On my way', clientMessageId: 'reply-0002', confirmed: true, replyToMessageId: '' }) });
  assert.equal(empty.status, 400); assert.deepEqual(await empty.json(), { error: 'invalid_request' });
  const wrongType = await fetch(`${baseUrl}/api/chats/chat-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'On my way', clientMessageId: 'reply-0003', confirmed: true, replyToMessageId: 42 }) });
  assert.equal(wrongType.status, 400); assert.deepEqual(await wrongType.json(), { error: 'invalid_request' });
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
