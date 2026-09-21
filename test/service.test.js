import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBeeperService } from '../src/service.js';

const requests = [];

test('Beeper SDK pages use items and project bridge fields for the UI', async () => {
  const service = createBeeperService({ client: {
    chats: {
      async list(...args) {
        requests.push({ operation: 'listChats', args });
        return { items: [{ id: 'chat-1', title: 'Family', unreadCount: 2, draft: { text: 'Unsaved draft' }, preview: { text: 'Dinner at six?' } }] };
      },
    },
    messages: {
      async list(...args) {
        requests.push({ operation: 'listMessages', args });
        return { items: [
          { id: 'message-1', chatID: 'chat-1', senderID: 'user-1', senderName: 'Alex', text: 'First', timestamp: '2026-09-20T12:00:00.000Z' },
          { id: 'message-2', chatID: 'chat-1', senderID: 'user-2', text: 'Second', timestamp: '2026-09-20T12:01:00.000Z' },
          { id: 'message-3', chatID: 'chat-1', senderID: 'user-3', text: 'Third', timestamp: '2026-09-20T12:02:00.000Z' },
        ] };
      },
      async search(...args) {
        requests.push({ operation: 'search', args });
        return { items: [{ id: 'message-4', chatID: 'chat-1', senderID: 'user-1', senderName: 'Alex', text: 'Dinner at six?', timestamp: '2026-09-20T12:03:00.000Z' }] };
      },
      async send(...args) {
        requests.push({ operation: 'send', args });
        return { pendingMessageID: 'pending-1' };
      },
    },
  } });

  assert.deepEqual(await service.listChats(), [{ id: 'chat-1', title: 'Family', unreadCount: 2, preview: 'Dinner at six?' }]);
  assert.equal(await service.getUnreadCount(), 2);
  assert.deepEqual(await service.listMessages('chat-1', 2), [
    { id: 'message-2', chatId: 'chat-1', chatTitle: '', sender: 'user-2', text: 'Second', timestamp: '2026-09-20T12:01:00.000Z' },
    { id: 'message-3', chatId: 'chat-1', chatTitle: '', sender: 'user-3', text: 'Third', timestamp: '2026-09-20T12:02:00.000Z' },
  ]);
  assert.deepEqual(await service.search('dinner', 2), [{ id: 'message-4', chatId: 'chat-1', chatTitle: '', sender: 'Alex', text: 'Dinner at six?', timestamp: '2026-09-20T12:03:00.000Z' }]);
  assert.deepEqual(await service.sendText({ chatId: 'chat-1', text: 'See you soon' }), { id: 'pending-1' });
  const chatRequests = requests.filter((request) => request.operation === 'listChats');
  assert.equal(chatRequests.length, 2);
  assert.equal(chatRequests.every((request) => request.args.length === 0), true);
  const messageRequest = requests.find((request) => request.operation === 'listMessages');
  assert.deepEqual(messageRequest.args, ['chat-1']);
  const searchRequest = requests.find((request) => request.operation === 'search');
  assert.deepEqual(searchRequest.args, [{ query: 'dinner', limit: 2 }]);
});