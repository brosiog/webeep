import BeeperDesktop from '@beeper/desktop-api';

function reactionProjection(reaction, senderLabelByID = new Map()) {
  if (typeof reaction?.reactionKey !== 'string' || !reaction.reactionKey.trim()) return null;
  const projected = {
    key: reaction.reactionKey,
    participant: (senderLabelByID.get(reaction.participantID) ?? reaction.participantID ?? '').trim() || 'Unknown participant',
  };
  if (typeof reaction.participantID === 'string' && reaction.participantID) projected.participantId = reaction.participantID;
  if (typeof reaction.emoji === 'boolean') projected.emoji = reaction.emoji;
  return projected;
}

function messageProjection(message, chatTitle = '', senderLabelByID = new Map(), fallbackSender = '') {
  const attachments = (message.attachments ?? []).map((attachment) => {
    const projected = {
      assetURL: attachment.id ?? attachment.srcURL ?? '',
      type: attachment.type,
      fileName: attachment.fileName ?? '',
      mimeType: attachment.mimeType ?? '',
    };
    if (Number.isFinite(attachment.fileSize)) projected.fileSize = attachment.fileSize;
    if (Number.isFinite(attachment.duration)) projected.duration = attachment.duration;
    if (attachment.posterImg) projected.posterImg = attachment.posterImg;
    return projected;
  }).filter((attachment) => attachment.assetURL);
  const reactions = (message.reactions ?? []).map((reaction) => reactionProjection(reaction, senderLabelByID)).filter(Boolean);
  const replyToMessageId = typeof message.linkedMessageID === 'string' && message.linkedMessageID ? message.linkedMessageID : '';
  return {
    id: message.id,
    chatId: message.chatID,
    chatTitle,
    sender: message.isSender ? 'You' : ((senderLabelByID.get(message.senderID) ?? message.senderName ?? fallbackSender) || 'Unknown participant'),
    text: message.text ?? '',
    ...(attachments.length ? { attachments } : {}),
    ...(reactions.length ? { reactions } : {}),
    ...(replyToMessageId ? { replyToMessageId } : {}),
    timestamp: message.timestamp,
  };
}

/** Narrow application service backed by the official Beeper Desktop SDK. */
export function createBeeperService({ accessToken, baseURL, client: providedClient }) {
  const client = providedClient ?? new BeeperDesktop({ accessToken, baseURL, logLevel: 'off', maxRetries: 0 });
  return {
    async listChats() {
      const page = await client.chats.list();
      return page.items.slice(0, 50).map((chat) => ({
        id: chat.id,
        title: chat.title,
        type: chat.type ?? 'single',
        participantPhoneNumbers: (chat.participants?.items ?? [])
          .filter((participant) => participant.phoneNumber && !participant.isSelf)
          .map((participant) => participant.phoneNumber),
        unreadCount: chat.unreadCount,
        preview: chat.preview?.text ?? '',
      }));
    },
    async getUnreadCount() {
      return (await this.listChats()).reduce((total, chat) => total + chat.unreadCount, 0);
    },
    async listMessages(chatId, limit) {
      const [page, chat] = await Promise.all([
        client.messages.list(chatId),
        client.chats.retrieve(chatId, { maxParticipantCount: -1 }),
      ]);
      const senderLabelByID = new Map(
        (chat.participants?.items ?? [])
          .map((participant) => [participant.id, participant.phoneNumber ?? participant.fullName ?? participant.username])
          .filter(([, label]) => label),
      );
      const fallbackSender = chat.type === 'single' ? chat.title : '';
      return page.items.slice(-limit).map((message) => messageProjection(message, '', senderLabelByID, fallbackSender));
    },
    async search(query, limit) {
      const page = await client.messages.search({ query, limit });
      return page.items.slice(0, limit).map((message) => messageProjection(message));
    },
    async serveAsset(url) {
      return client.assets.serve({ url });
    },
    async sendText({ chatId, text, replyToMessageId }) {
      const result = await client.messages.send(chatId, {
        text,
        ...(replyToMessageId ? { replyToMessageID: replyToMessageId } : {}),
      });
      return { id: result.pendingMessageID };
    },
    async sendReaction({ chatId, messageId, emoji }) {
      const result = await client.chats.messages.reactions.add(messageId, { chatID: chatId, reactionKey: emoji });
      return { chatId: result.chatID ?? chatId, messageId: result.messageID ?? messageId, emoji: result.reactionKey ?? emoji };
    },
    async removeReaction({ chatId, messageId, emoji }) {
      const result = await client.chats.messages.reactions.delete(emoji, { chatID: chatId, messageID: messageId });
      return { chatId: result.chatID ?? chatId, messageId: result.messageID ?? messageId, emoji: result.reactionKey ?? emoji };
    },
  };
}

/** Deterministic local fixture; it never opens a network connection. */
export function createMockService() {
  const chats = [{ id: 'chat-1', title: 'Family', type: 'group', unreadCount: 2, preview: 'Dinner at six?' }];
  const messages = [
    { id: 'message-1', chatId: 'chat-1', sender: 'Alex', text: 'Dinner at six?', reactions: [{ key: '❤️', participant: 'Alex' }], timestamp: '2026-09-20T12:00:00.000Z' },
    { id: 'message-2', chatId: 'chat-1', sender: 'You', text: 'Yes, see you at six!', replyToMessageId: 'message-1', timestamp: '2026-09-20T12:01:00.000Z' },
  ];
  let nextId = 1;
  return {
    async listChats() { return chats; },
    async getUnreadCount() { return chats.reduce((total, chat) => total + chat.unreadCount, 0); },
    async listMessages(chatId, limit) { return messages.filter((message) => message.chatId === chatId).slice(-limit); },
    async search(query, limit) {
      const needle = query.toLowerCase();
      return messages.filter((message) => message.text.toLowerCase().includes(needle)).slice(0, limit).map((message) => ({ ...message, chatTitle: 'Family' }));
    },
    async sendText({ chatId, text, clientMessageId, replyToMessageId }) {
      const message = { id: `pending-${nextId++}`, chatId, sender: 'You', text, timestamp: '2026-09-20T12:01:00.000Z', clientMessageId };
      if (replyToMessageId) message.replyToMessageId = replyToMessageId;
      messages.push(message);
      return { id: message.id };
    },
    async sendReaction({ chatId, messageId, emoji }) {
      const message = messages.find((item) => item.chatId === chatId && item.id === messageId);
      if (!message) throw Object.assign(new Error('not_found'), { status: 404 });
      message.reactions ??= [];
      if (!message.reactions.some((reaction) => reaction.key === emoji && reaction.participant === 'You')) {
        message.reactions.push({ key: emoji, participant: 'You' });
      }
      return { chatId, messageId, emoji };
    },
    async removeReaction({ chatId, messageId, emoji }) {
      const message = messages.find((item) => item.chatId === chatId && item.id === messageId);
      if (!message) throw Object.assign(new Error('not_found'), { status: 404 });
      message.reactions = (message.reactions ?? []).filter((reaction) => !(reaction.key === emoji && reaction.participant === 'You'));
      return { chatId, messageId, emoji };
    },
  };
}
