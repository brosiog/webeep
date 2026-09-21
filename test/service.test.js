import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBeeperService } from '../src/service.js';

const requests = [];

test('Beeper SDK pages use items and project bridge fields for the UI', async () => {
  const service = createBeeperService({ client: {
    chats: {
      async list(...args) {
        requests.push({ operation: 'listChats', args });
        return { items: [{ id: 'chat-1', title: 'Family', type: 'group', participants: { items: [{ id: 'user-1', phoneNumber: '+15550101' }, { id: 'self', phoneNumber: '+15550999', isSelf: true }] }, unreadCount: 2, draft: { text: 'Unsaved draft' }, preview: { text: 'Dinner at six?' } }] };
      },
      async retrieve(...args) {
        requests.push({ operation: 'retrieveChat', args });
        return { participants: { items: [
          { id: 'user-1', phoneNumber: '+15550101' },
          { id: 'user-2', phoneNumber: '+15550102' },
          { id: 'user-3', phoneNumber: '+15550103' },
        ] } };
      },
      messages: {
        reactions: {
          async add(...args) {
            requests.push({ operation: 'addReaction', args });
            return { chatID: 'chat-1', messageID: 'message-1', reactionKey: '❤️', success: true, transactionID: 'txn-1' };
          },
          async delete(...args) {
            requests.push({ operation: 'deleteReaction', args });
            return { chatID: 'chat-1', messageID: 'message-1', reactionKey: '❤️', success: true };
          },
        },
      },
    },
    messages: {
      async list(...args) {
        requests.push({ operation: 'listMessages', args });
        return { items: [
          { id: 'message-1', chatID: 'chat-1', senderID: 'user-1', senderName: 'Alex', text: 'First', attachments: [{ id: 'mxc://beeper.example/photo', type: 'img', fileName: 'photo.jpg', fileSize: 1200, mimeType: 'image/jpeg' }], reactions: [{ id: 'user-2❤️', participantID: 'user-2', reactionKey: '❤️', emoji: true }], timestamp: '2026-09-20T12:00:00.000Z' },
          { id: 'message-2', chatID: 'chat-1', senderID: 'user-2', text: 'Second', linkedMessageID: 'message-1', timestamp: '2026-09-20T12:01:00.000Z' },
          { id: 'message-3', chatID: 'chat-1', senderID: 'user-3', text: 'Third', timestamp: '2026-09-20T12:02:00.000Z' },
          { id: 'message-4', chatID: 'chat-1', senderID: 'user-2', type: 'REACTION', linkedMessageID: 'message-1', timestamp: '2026-09-20T12:03:00.000Z' },
        ] };
      },
      async search(...args) {
        requests.push({ operation: 'search', args });
        return { items: [{ id: 'message-4', chatID: 'chat-1', senderID: 'user-1', senderName: 'Alex', text: 'Dinner at six?', timestamp: '2026-09-20T12:03:00.000Z' }, { id: 'message-5', chatID: 'chat-1', senderID: 'user-2', type: 'REACTION', text: 'Dinner at six?', linkedMessageID: 'message-4', timestamp: '2026-09-20T12:04:00.000Z' }] };
      },
      async send(...args) {
        requests.push({ operation: 'send', args });
        return { pendingMessageID: 'pending-1' };
      },
    },
    assets: {
      async uploadBase64(...args) {
        requests.push({ operation: 'upload', args });
        return { uploadID: 'upload-1', fileName: 'photo.jpg', fileSize: 5, mimeType: 'image/jpeg' };
      },
    },
  } });

  assert.deepEqual(await service.listChats(), [{ id: 'chat-1', title: 'Family', type: 'group', participantPhoneNumbers: ['+15550101'], unreadCount: 2, preview: 'Dinner at six?' }]);
  assert.equal(await service.getUnreadCount(), 2);
  assert.deepEqual(await service.listMessages('chat-1', 3), [
    { id: 'message-1', chatId: 'chat-1', chatTitle: '', sender: '+15550101', text: 'First', attachments: [{ assetURL: 'mxc://beeper.example/photo', type: 'img', fileName: 'photo.jpg', fileSize: 1200, mimeType: 'image/jpeg' }], reactions: [{ key: '❤️', participant: '+15550102', participantId: 'user-2', emoji: true }], timestamp: '2026-09-20T12:00:00.000Z' },
    { id: 'message-2', chatId: 'chat-1', chatTitle: '', sender: '+15550102', text: 'Second', replyToMessageId: 'message-1', timestamp: '2026-09-20T12:01:00.000Z' },
    { id: 'message-3', chatId: 'chat-1', chatTitle: '', sender: '+15550103', text: 'Third', timestamp: '2026-09-20T12:02:00.000Z' },
  ]);
  assert.deepEqual(await service.search('dinner', 2), [{ id: 'message-4', chatId: 'chat-1', chatTitle: '', sender: 'Alex', text: 'Dinner at six?', timestamp: '2026-09-20T12:03:00.000Z' }]);
  assert.deepEqual(await service.sendText({ chatId: 'chat-1', text: 'See you soon' }), { id: 'pending-1' });
  assert.deepEqual(requests.filter((request) => request.operation === 'send').at(-1).args, ['chat-1', { text: 'See you soon' }]);
  assert.deepEqual(await service.sendText({ chatId: 'chat-1', text: 'On my way', replyToMessageId: 'message-1' }), { id: 'pending-1' });
  assert.deepEqual(requests.filter((request) => request.operation === 'send').at(-1).args, ['chat-1', { text: 'On my way', replyToMessageID: 'message-1' }]);
  assert.deepEqual(await service.sendText({ chatId: 'chat-1', text: '', attachment: { fileName: 'photo.jpg', mimeType: 'image/jpeg', data: 'aGVsbG8=' } }), { id: 'pending-1' });
  assert.deepEqual(requests.find((request) => request.operation === 'upload').args, [{ content: 'aGVsbG8=', fileName: 'photo.jpg', mimeType: 'image/jpeg' }]);
  assert.deepEqual(requests.filter((request) => request.operation === 'send').at(-1).args, ['chat-1', { attachment: { uploadID: 'upload-1', fileName: 'photo.jpg', mimeType: 'image/jpeg' } }]);
  assert.deepEqual(await service.sendReaction({ chatId: 'chat-1', messageId: 'message-1', emoji: '❤️' }), { chatId: 'chat-1', messageId: 'message-1', emoji: '❤️' });
  assert.deepEqual(await service.removeReaction({ chatId: 'chat-1', messageId: 'message-1', emoji: '❤️' }), { chatId: 'chat-1', messageId: 'message-1', emoji: '❤️' });
  assert.deepEqual(requests.find((request) => request.operation === 'addReaction').args, ['message-1', { chatID: 'chat-1', reactionKey: '❤️' }]);
  assert.deepEqual(requests.find((request) => request.operation === 'deleteReaction').args, ['❤️', { chatID: 'chat-1', messageID: 'message-1' }]);
  const chatRequests = requests.filter((request) => request.operation === 'listChats');
  assert.equal(chatRequests.length, 2);
  assert.equal(chatRequests.every((request) => request.args.length === 0), true);
  const messageRequest = requests.find((request) => request.operation === 'listMessages');
  assert.deepEqual(messageRequest.args, ['chat-1']);
  const retrieveRequest = requests.find((request) => request.operation === 'retrieveChat');
  assert.deepEqual(retrieveRequest.args, ['chat-1', { maxParticipantCount: -1 }]);
  const searchRequest = requests.find((request) => request.operation === 'search');
  assert.deepEqual(searchRequest.args, [{ query: 'dinner', limit: 2 }]);
});
