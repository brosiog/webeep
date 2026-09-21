import BeeperDesktop from '@beeper/desktop-api';

function messageProjection(message, chatTitle = '') {
  return {
    id: message.id,
    chatId: message.chatID,
    chatTitle,
    sender: message.senderName ?? message.senderID ?? 'Unknown',
    text: message.text ?? '',
    timestamp: message.timestamp,
  };
}

/** Narrow application service backed by the official Beeper Desktop SDK. */
export function createBeeperService({ accessToken, baseURL, client: providedClient }) {
  const client = providedClient ?? new BeeperDesktop({ accessToken, baseURL, logLevel: 'off', maxRetries: 0 });
  return {
    async listChats() {
      const page = await client.chats.list();
      return page.items.slice(0, 50).map((chat) => ({ id: chat.id, title: chat.title, unreadCount: chat.unreadCount, preview: chat.preview?.text ?? '' }));
    },
    async getUnreadCount() {
      return (await this.listChats()).reduce((total, chat) => total + chat.unreadCount, 0);
    },
    async listMessages(chatId, limit) {
      const page = await client.messages.list(chatId);
      return page.items.slice(-limit).map((message) => messageProjection(message));
    },
    async search(query, limit) {
      const page = await client.messages.search({ query, limit });
      return page.items.slice(0, limit).map((message) => messageProjection(message));
    },
    async sendText({ chatId, text }) {
      const result = await client.messages.send(chatId, { text });
      return { id: result.pendingMessageID };
    },
  };
}

/** Deterministic local fixture; it never opens a network connection. */
export function createMockService() {
  const chats = [{ id: 'chat-1', title: 'Family', unreadCount: 2, preview: 'Dinner at six?' }];
  const messages = [{ id: 'message-1', chatId: 'chat-1', sender: 'Alex', text: 'Dinner at six?', timestamp: '2026-09-20T12:00:00.000Z' }];
  let nextId = 1;
  return {
    async listChats() { return chats; },
    async getUnreadCount() { return chats.reduce((total, chat) => total + chat.unreadCount, 0); },
    async listMessages(chatId, limit) { return messages.filter((message) => message.chatId === chatId).slice(-limit); },
    async search(query, limit) {
      const needle = query.toLowerCase();
      return messages.filter((message) => message.text.toLowerCase().includes(needle)).slice(0, limit).map((message) => ({ ...message, chatTitle: 'Family' }));
    },
    async sendText({ chatId, text, clientMessageId }) {
      const message = { id: `pending-${nextId++}`, chatId, sender: 'You', text, timestamp: '2026-09-20T12:01:00.000Z', clientMessageId };
      messages.push(message);
      return { id: message.id };
    },
  };
}