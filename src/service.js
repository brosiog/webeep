import BeeperDesktop from '@beeper/desktop-api';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

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

function messageProjection(message, { chatTitle = '', senderLabelByID = new Map(), fallbackSender = '', onAssetURL } = {}) {
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
    if (projected.assetURL && typeof onAssetURL === 'function') onAssetURL(projected.assetURL);
    return projected;
  }).filter((attachment) => attachment.assetURL);
  const reactions = (message.reactions ?? []).map((reaction) => reactionProjection(reaction, senderLabelByID)).filter(Boolean);
  const replyToMessageId = typeof message.linkedMessageID === 'string' && message.linkedMessageID ? message.linkedMessageID : '';
  const read = message.seen === true;
  return {
    id: message.id,
    chatId: message.chatID,
    chatTitle,
    sender: message.isSender ? 'You' : ((senderLabelByID.get(message.senderID) ?? message.senderName ?? fallbackSender) || 'Unknown participant'),
    text: message.text ?? '',
    ...(attachments.length ? { attachments } : {}),
    ...(reactions.length ? { reactions } : {}),
    ...(replyToMessageId ? { replyToMessageId } : {}),
    ...(read ? { read } : {}),
    timestamp: message.timestamp,
  };
}

/** Narrow application service backed by the official Beeper Desktop SDK. */
export function createBeeperService({ accessToken, baseURL, client: providedClient }) {
  const client = providedClient ?? new BeeperDesktop({ accessToken, baseURL, logLevel: 'off', maxRetries: 0 });
  // URLs the bridge recently handed us in a projection. file:// asset URLs reach
  // into the bridge host filesystem, so only these may be served back.
  const recentAssetURLs = [];
  const recentAssetSet = new Set();
  const trackAssetURL = (url) => {
    if (recentAssetSet.has(url)) return;
    recentAssetURLs.push(url);
    recentAssetSet.add(url);
    if (recentAssetURLs.length > 1000) recentAssetSet.delete(recentAssetURLs.shift());
  };
  return {
    isAssetAllowed(url) { return recentAssetSet.has(url); },
    async listChats() {
      const page = await client.chats.list();
      return page.items.slice(0, 50).map((chat) => ({
        id: chat.id,
        title: chat.title,
        type: chat.type ?? 'single',
        network: chat.network ?? '',
        participantPhoneNumbers: (chat.participants?.items ?? [])
          .filter((participant) => participant.phoneNumber && !participant.isSelf)
          .map((participant) => participant.phoneNumber),
        unreadCount: chat.unreadCount,
        preview: chat.preview?.text ?? '',
        lastActivity: chat.preview?.timestamp ?? '',
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
      // The bridge echoes each reaction as a standalone REACTION message; those are
      // hidden here because reactions already surface as chips on the target message.
      return page.items.filter((message) => message.type !== 'REACTION').slice(-limit).map((message) => messageProjection(message, { senderLabelByID, fallbackSender, onAssetURL: trackAssetURL }));
    },
    async search(query, limit) {
      const page = await client.messages.search({ query, limit });
      return page.items.filter((message) => message.type !== 'REACTION').slice(0, limit).map((message) => messageProjection(message, { onAssetURL: trackAssetURL }));
    },
    async serveAsset(url) {
      return client.assets.serve({ url });
    },
    async markRead({ chatId }) {
      await client.chats.markRead(chatId);
      return { chatId };
    },
    async sendText({ chatId, text, replyToMessageId, attachment }) {
      let attachmentParam;
      if (attachment) {
        const bytes = Buffer.from(attachment.data, 'base64');
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
          throw Object.assign(new Error('attachment_too_large'), { status: 413 });
        }
        const upload = await client.assets.uploadBase64({
          content: attachment.data,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
        });
        if (!upload.uploadID) throw new Error('upload_failed');
        attachmentParam = { uploadID: upload.uploadID, fileName: attachment.fileName, mimeType: attachment.mimeType };
      }
      const result = await client.messages.send(chatId, {
        ...(text ? { text } : {}),
        ...(replyToMessageId ? { replyToMessageID: replyToMessageId } : {}),
        ...(attachmentParam ? { attachment: attachmentParam } : {}),
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

function inferAttachmentType(mimeType) {
  if (mimeType.startsWith('image/')) return 'img';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Deterministic local fixture; it never opens a network connection. */
export function createMockService() {
  const chats = [{ id: 'chat-1', title: 'Family', type: 'group', network: 'Mock', unreadCount: 2, preview: 'Dinner at six?', lastActivity: '2026-09-20T12:00:00.000Z' }];
  const markChatReadMock = (chatId) => {
    const chat = chats.find((item) => item.id === chatId);
    if (chat) chat.unreadCount = 0;
    return { chatId };
  };
  const messages = [
    { id: 'message-1', chatId: 'chat-1', sender: 'Alex', text: 'Dinner at six?', reactions: [{ key: '❤️', participant: 'Alex' }], timestamp: '2026-09-20T12:00:00.000Z' },
    { id: 'message-2', chatId: 'chat-1', sender: 'You', text: 'Yes, see you at six!', replyToMessageId: 'message-1', read: true, timestamp: '2026-09-20T12:01:00.000Z' },
    { id: 'message-3', chatId: 'chat-1', sender: 'Alex', text: '', type: 'REACTION', replyToMessageId: 'message-1', timestamp: '2026-09-20T12:02:00.000Z' },
    { id: 'message-4', chatId: 'chat-1', sender: 'Cronjob Bot', text: 'Cronjob Response: Regal Mystery Monday movie<br>(job_id: 812d1dd2a500)<br><br><strong>Regal Mystery Movie — Monday, September 21, 2026</strong><br>• <strong>PG-13</strong>, <strong>1h 41m</strong><br><a href="https://www.regmovies.com/movies/heart-of-the-beast-ho00021867">https://www.regmovies.com/movies/heart-of-the-beast-ho00021867</a>', timestamp: '2026-09-20T12:03:00.000Z' },
  ];
  let nextId = 1;
  const notFound = () => Object.assign(new Error('not_found'), { status: 404 });
  const findMessage = (chatId, messageId) => {
    const message = messages.find((item) => item.chatId === chatId && item.id === messageId);
    if (!message) throw notFound();
    return message;
  };
  return {
    async listChats() { return chats; },
    async getUnreadCount() { return chats.reduce((total, chat) => total + chat.unreadCount, 0); },
    async listMessages(chatId, limit) { return messages.filter((message) => message.chatId === chatId && message.type !== 'REACTION').slice(-limit); },
    async search(query, limit) {
      const needle = query.toLowerCase();
      return messages.filter((message) => message.type !== 'REACTION' && message.text.toLowerCase().includes(needle)).slice(0, limit).map((message) => ({ ...message, chatTitle: 'Family' }));
    },
    async sendText({ chatId, text, clientMessageId, replyToMessageId, attachment }) {
      const id = `pending-${nextId++}`;
      const message = { id, chatId, sender: 'You', text: text ?? '', timestamp: '2026-09-20T12:01:00.000Z', clientMessageId };
      if (replyToMessageId) message.replyToMessageId = replyToMessageId;
      if (attachment) {
        const bytes = Buffer.from(attachment.data, 'base64');
        message.attachments = [{
          assetURL: `localmxc://mock/${id}`,
          type: inferAttachmentType(attachment.mimeType),
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: bytes.byteLength,
          data: attachment.data,
        }];
      }
      messages.push(message);
      return { id: message.id };
    },
    async markRead({ chatId }) {
      return markChatReadMock(chatId);
    },
    isAssetAllowed(url) {
      return messages.some((message) => (message.attachments ?? []).some((item) => item.assetURL === url));
    },
    async serveAsset(url) {
      const found = messages.flatMap((message) => message.attachments ?? []).find((item) => item.assetURL === url);
      if (!found?.data) return { ok: false, status: 404, headers: new Map(), body: null };
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', found.mimeType]]),
        body: new Blob([Buffer.from(found.data, 'base64')]).stream(),
      };
    },
    async sendReaction({ chatId, messageId, emoji }) {
      const message = findMessage(chatId, messageId);
      message.reactions ??= [];
      if (!message.reactions.some((reaction) => reaction.key === emoji && reaction.participant === 'You')) {
        message.reactions.push({ key: emoji, participant: 'You' });
      }
      return { chatId, messageId, emoji };
    },
    async removeReaction({ chatId, messageId, emoji }) {
      const message = findMessage(chatId, messageId);
      message.reactions = (message.reactions ?? []).filter((reaction) => !(reaction.key === emoji && reaction.participant === 'You'));
      return { chatId, messageId, emoji };
    },
  };
}
