import { createClientMessageId } from './client-message-id.js';

const chatList = document.querySelector('#chat-list');
const chatStatus = document.querySelector('#chat-status');
const messageList = document.querySelector('#message-list');
const threadStatus = document.querySelector('#thread-status');
const threadTitle = document.querySelector('#thread-title');
const unreadCount = document.querySelector('#unread-count');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-input');
const sendForm = document.querySelector('#send-form');
const messageInput = document.querySelector('#message-input');
const refreshButton = document.querySelector('#refresh-button');
const sendButton = document.querySelector('.send-button');
const inboxButton = document.querySelector('#inbox-button');
const contactsButton = document.querySelector('#contacts-button');
const inboxView = document.querySelector('#inbox-view');
const contactsView = document.querySelector('#contacts-view');
const contactList = document.querySelector('#contact-list');
const contactsStatus = document.querySelector('#contacts-status');

let selectedChat = null;
let replyTarget = null;
const replyBar = document.createElement('div');
replyBar.className = 'reply-bar';
replyBar.hidden = true;
sendForm.before(replyBar);
let chatsById = new Map();
let numbersByChatId = new Map();
let displayedMessageSignature = '';
let pollInFlight = false;
const POLL_INTERVAL_MS = 10_000;
const REACTION_EMOJIS = ['❤️', '👍', '👎', '😂', '😮', '😢', '🙏', '🎉'];

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`request_failed_${response.status}`);
  return data;
}

function setStatus(element, message) {
  element.textContent = message;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString();
}

function renderChats(chats) {
  chatsById = new Map(chats.map((chat) => [chat.id, chat]));
  chatList.replaceChildren();
  for (const chat of chats) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-button';
    if (chat.id === selectedChat?.id) button.classList.add('is-selected');
    button.dataset.chatId = chat.id;
    button.addEventListener('click', () => loadThread(chat));
    const copy = document.createElement('span');
    copy.className = 'chat-copy';
    const title = document.createElement('span');
    title.className = 'chat-title';
    title.textContent = chat.title || 'Untitled chat';
    const preview = document.createElement('span');
    preview.className = 'preview';
    preview.textContent = chat.preview || '';
    copy.append(title, preview);
    button.append(copy);
    if (chat.unreadCount) {
      const unread = document.createElement('span');
      unread.className = 'chat-unread';
      unread.textContent = chat.unreadCount > 99 ? '99+' : chat.unreadCount;
      button.append(unread);
    }
    item.append(button);
    chatList.append(item);
  }
  if (chats.length === 0) chatList.textContent = 'No chats found.';
}

function renderContacts(contacts) {
  contactList.replaceChildren();
  for (const contact of contacts) {
    const item = document.createElement('li');
    item.className = 'contact-card';
    const copy = document.createElement('div');
    copy.className = 'contact-copy';
    const number = document.createElement('span');
    number.className = 'contact-number';
    number.textContent = contact.number;
    const preview = document.createElement('span');
    preview.className = 'preview';
    preview.textContent = contact.preview || 'No recent preview';
    copy.append(number, preview);
    const form = document.createElement('form');
    form.className = 'contact-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 100;
    input.placeholder = 'Add a name';
    input.value = contact.name;
    input.setAttribute('aria-label', `Name for ${contact.number}`);
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await request(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: input.value }) });
        await Promise.all([refreshChats(), refreshContacts()]);
      } catch {
        setStatus(contactsStatus, 'Unable to save that name.');
      } finally {
        save.disabled = false;
      }
    });
    form.append(input, save);
    item.append(copy, form);
    contactList.append(item);
  }
  if (contacts.length === 0) contactList.textContent = 'No number-only conversations yet.';
}

async function refreshContacts() {
  setStatus(contactsStatus, 'Loading number history…');
  try {
    const data = await request('/api/contacts');
    renderContacts(data.items);
    setStatus(contactsStatus, '');
  } catch {
    setStatus(contactsStatus, 'Unable to load number history.');
  }
}

async function showContacts() {
  inboxView.hidden = true;
  contactsView.hidden = false;
  inboxButton.classList.remove('is-active');
  inboxButton.setAttribute('aria-pressed', 'false');
  contactsButton.classList.add('is-active');
  contactsButton.setAttribute('aria-pressed', 'true');
  await refreshContacts();
}

function showInbox() {
  contactsView.hidden = true;
  inboxView.hidden = false;
  contactsButton.classList.remove('is-active');
  contactsButton.setAttribute('aria-pressed', 'false');
  inboxButton.classList.add('is-active');
  inboxButton.setAttribute('aria-pressed', 'true');
}

function messageSignature(messages) {
  return messages.map((message) => `${message.id}:${message.timestamp}:${message.sender}:${message.text}:${message.replyToMessageId ?? ''}:${(message.reactions ?? []).map((reaction) => `${reaction.key}=${reaction.participant}`).join(',')}`).join('|');
}

function snippet(text, max = 120) {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function setReplyTarget(target) {
  replyTarget = target;
  replyBar.replaceChildren();
  if (!target) {
    replyBar.hidden = true;
    return;
  }
  const label = document.createElement('span');
  label.className = 'reply-bar-label';
  label.textContent = `Replying to ${target.sender}`;
  const quote = document.createElement('span');
  quote.className = 'reply-bar-quote';
  quote.textContent = snippet(target.text) || '(no text)';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'reply-bar-cancel';
  cancel.textContent = '✕';
  cancel.setAttribute('aria-label', 'Cancel reply');
  cancel.addEventListener('click', () => {
    setReplyTarget(null);
    messageInput.focus();
  });
  replyBar.append(label, quote, cancel);
  replyBar.hidden = false;
}

function scrollToMessage(messageId) {
  const target = messageList.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('is-highlighted');
  window.setTimeout(() => target.classList.remove('is-highlighted'), 1600);
}

async function reactToMessage(chatId, messageId, emoji) {
  await request(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ emoji }),
  });
  await refreshSelectedThread();
}

async function unreactToMessage(chatId, messageId, emoji) {
  await request(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' });
  await refreshSelectedThread();
}

function closeOpenPalettes(except = null) {
  for (const palette of document.querySelectorAll('.reaction-palette:not([hidden])')) {
    if (palette !== except) palette.hidden = true;
  }
}

function renderReactionPalette(chatId, messageId) {
  const palette = document.createElement('div');
  palette.className = 'reaction-palette';
  palette.hidden = true;
  for (const emoji of REACTION_EMOJIS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'reaction-option';
    option.textContent = emoji;
    option.setAttribute('aria-label', `React with ${emoji}`);
    option.addEventListener('click', async () => {
      option.disabled = true;
      try {
        await reactToMessage(chatId, messageId, emoji);
      } catch {
        setStatus(threadStatus, 'Unable to add that reaction.');
      }
    });
    palette.append(option);
  }
  return palette;
}

function renderReactionChips(message, chatId) {
  const reactions = message.reactions ?? [];
  if (reactions.length === 0) return null;
  const grouped = new Map();
  for (const reaction of reactions) {
    if (!grouped.has(reaction.key)) grouped.set(reaction.key, []);
    grouped.get(reaction.key).push(reaction.participant || 'Unknown');
  }
  const wrap = document.createElement('div');
  wrap.className = 'reaction-chips';
  for (const [key, participants] of grouped) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'reaction-chip';
    if (participants.includes('You')) chip.classList.add('is-own');
    chip.textContent = participants.length > 1 ? `${key} ${participants.length}` : key;
    chip.title = participants.join(', ');
    chip.setAttribute('aria-label', `Remove ${key} reaction (${participants.join(', ')})`);
    chip.addEventListener('click', async () => {
      chip.disabled = true;
      try {
        await unreactToMessage(chatId, messageIdOf(message), key);
      } catch {
        chip.disabled = false;
        setStatus(threadStatus, 'Unable to remove that reaction.');
      }
    });
    wrap.append(chip);
  }
  return wrap;
}

function messageIdOf(message) {
  return message.id;
}

function isNearMessageListBottom() {
  return messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 48;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1) return '';
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderAttachment(attachment) {
  const link = document.createElement('a');
  link.className = `attachment attachment-${attachment.type || 'file'}`;
  link.href = attachment.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.setAttribute('aria-label', `Open attachment ${attachment.fileName || ''}`.trim());
  if (attachment.type === 'img') {
    const image = document.createElement('img');
    image.src = attachment.url;
    image.alt = attachment.fileName || 'Image attachment';
    image.loading = 'lazy';
    link.append(image);
    return link;
  }
  const icon = document.createElement('span');
  icon.className = 'attachment-icon';
  icon.textContent = attachment.type === 'video' ? '▶' : attachment.type === 'audio' ? '♪' : '↓';
  const copy = document.createElement('span');
  copy.className = 'attachment-copy';
  const name = document.createElement('strong');
  name.textContent = attachment.fileName || `${attachment.type || 'File'} attachment`;
  const details = document.createElement('small');
  details.textContent = [attachment.mimeType, formatFileSize(attachment.fileSize)].filter(Boolean).join(' · ') || 'Attachment';
  copy.append(name, details);
  link.append(icon, copy);
  return link;
}

function renderMessages(messages, fallbackSender, { stickToBottom = true } = {}) {
  const previousScrollTop = messageList.scrollTop;
  const previousScrollHeight = messageList.scrollHeight;
  messageList.replaceChildren();
  const chronological = [...messages].sort((a, b) => new Date(a.timestamp).valueOf() - new Date(b.timestamp).valueOf());
  const messageById = new Map(chronological.map((message) => [message.id, message]));
  for (const message of chronological) {
    const item = document.createElement('li');
    item.className = 'message';
    if (message.id) item.dataset.messageId = message.id;
    if (message.sender === 'You') item.classList.add('is-own');
    const sender = document.createElement('strong');
    sender.textContent = message.sender || fallbackSender;
    const text = document.createElement('p');
    text.textContent = message.text || '';
    const time = document.createElement('time');
    time.dateTime = message.timestamp || '';
    time.textContent = formatTimestamp(message.timestamp);
    item.append(sender);
    if (message.replyToMessageId) {
      const original = messageById.get(message.replyToMessageId);
      const quote = document.createElement('button');
      quote.type = 'button';
      quote.className = 'reply-quote';
      const quoteSender = document.createElement('strong');
      quoteSender.textContent = original ? (original.sender || fallbackSender) : 'Original message';
      const quoteText = document.createElement('span');
      quoteText.textContent = original ? (snippet(original.text) || '(no text)') : 'Not loaded in this thread';
      quote.append(quoteSender, quoteText);
      if (original) quote.addEventListener('click', () => scrollToMessage(message.replyToMessageId));
      else quote.disabled = true;
      item.append(quote);
    }
    item.append(text);
    for (const attachment of message.attachments ?? []) {
      if (attachment.url) item.append(renderAttachment(attachment));
    }
    const chatId = selectedChat?.id ?? message.chatId;
    const chips = renderReactionChips(message, chatId);
    if (chips) item.append(chips);
    const footer = document.createElement('div');
    footer.className = 'message-footer';
    footer.append(time);
    if (chatId && message.id) {
      const replyButton = document.createElement('button');
      replyButton.type = 'button';
      replyButton.className = 'reply-button';
      replyButton.textContent = '↩';
      replyButton.setAttribute('aria-label', `Reply to message from ${message.sender || fallbackSender}`);
      replyButton.addEventListener('click', () => {
        setReplyTarget({ id: message.id, sender: message.sender || fallbackSender, text: message.text || '' });
        messageInput.focus();
      });
      const reactButton = document.createElement('button');
      reactButton.type = 'button';
      reactButton.className = 'react-button';
      reactButton.textContent = '🙂';
      reactButton.setAttribute('aria-label', `React to message from ${message.sender || fallbackSender}`);
      const palette = renderReactionPalette(chatId, message.id);
      reactButton.addEventListener('click', () => {
        const willOpen = palette.hidden;
        closeOpenPalettes(palette);
        palette.hidden = !willOpen;
      });
      footer.append(replyButton, reactButton);
      item.append(footer, palette);
    } else {
      item.append(footer);
    }
    messageList.append(item);
  }
  if (messages.length === 0) messageList.textContent = 'No messages found.';
  requestAnimationFrame(() => {
    messageList.scrollTop = stickToBottom
      ? messageList.scrollHeight
      : previousScrollTop + (messageList.scrollHeight - previousScrollHeight);
  });
}

async function loadThread(chat) {
  selectedChat = chat;
  for (const button of chatList.querySelectorAll('.chat-button')) {
    button.classList.toggle('is-selected', button.dataset.chatId === chat.id);
  }
  threadTitle.textContent = chat.title || 'Untitled chat';
  sendForm.hidden = false;
  setStatus(threadStatus, 'Loading messages…');
  messageList.replaceChildren();
  displayedMessageSignature = '';
  setReplyTarget(null);
  await refreshSelectedThread({ initialLoad: true });
}

async function refreshSelectedThread({ initialLoad = false } = {}) {
  const chat = selectedChat;
  if (!chat) return;
  try {
    const data = await request(`/api/chats/${encodeURIComponent(chat.id)}/messages?limit=50`);
    if (selectedChat?.id !== chat.id) return;
    const nextSignature = messageSignature(data.items);
    if (!initialLoad && nextSignature === displayedMessageSignature) return;
    const fallbackSender = numbersByChatId.get(chat.id) ?? chat.title ?? 'Unknown';
    renderMessages(data.items, fallbackSender, { stickToBottom: initialLoad || isNearMessageListBottom() });
    displayedMessageSignature = nextSignature;
    setStatus(threadStatus, '');
  } catch {
    if (initialLoad) setStatus(threadStatus, 'Unable to load messages.');
  }
}

async function refreshChats({ quiet = false } = {}) {
  if (!quiet) setStatus(chatStatus, 'Loading chats…');
  const previousScrollTop = chatList.scrollTop;
  try {
    const [chats, unread, contacts] = await Promise.all([request('/api/chats'), request('/api/unread-count'), request('/api/contacts')]);
    numbersByChatId = new Map(contacts.items.filter((contact) => contact.chatId).map((contact) => [contact.chatId, contact.number]));
    renderChats(chats.items);
    if (selectedChat && chatsById.has(selectedChat.id)) selectedChat = chatsById.get(selectedChat.id);
    unreadCount.textContent = unread.total > 99 ? '99+' : unread.total;
    unreadCount.setAttribute('aria-label', `${unread.total} unread message${unread.total === 1 ? '' : 's'}`);
    unreadCount.hidden = unread.total === 0;
    chatList.scrollTop = previousScrollTop;
    if (!quiet) setStatus(chatStatus, '');
  } catch {
    if (!quiet) setStatus(chatStatus, 'Unable to load chats.');
    unreadCount.textContent = 'Unread: unavailable';
  }
}

async function pollForUpdates() {
  if (pollInFlight || document.hidden) return;
  pollInFlight = true;
  try {
    if (!searchInput.value.trim()) await refreshChats({ quiet: true });
    await refreshSelectedThread();
    if (!contactsView.hidden) await refreshContacts();
  } finally {
    pollInFlight = false;
  }
}

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return refreshChats();
  setStatus(chatStatus, 'Searching…');
  try {
    const data = await request(`/api/search?q=${encodeURIComponent(query)}&limit=20`);
    renderChats(data.items.map((message) => ({
      id: message.chatId,
      title: message.chatTitle || message.chatId,
      unreadCount: 0,
      preview: `${message.sender}: ${message.text}`,
    })));
    setStatus(chatStatus, `${data.items.length} result${data.items.length === 1 ? '' : 's'}`);
  } catch {
    setStatus(chatStatus, 'Unable to search messages.');
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.reaction-palette') && !event.target.closest('.react-button')) closeOpenPalettes();
});

refreshButton.addEventListener('click', refreshChats);
inboxButton.addEventListener('click', showInbox);
contactsButton.addEventListener('click', showContacts);

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 140)}px`;
});

messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendForm.requestSubmit();
  }
});

sendForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!selectedChat || !text) return;
  sendButton.disabled = true;
  setStatus(threadStatus, 'Sending…');
  try {
    await request(`/api/chats/${encodeURIComponent(selectedChat.id)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        confirmed: true,
        clientMessageId: createClientMessageId(),
        ...(replyTarget ? { replyToMessageId: replyTarget.id } : {}),
      }),
    });
    messageInput.value = '';
    messageInput.style.height = '';
    setReplyTarget(null);
    await Promise.all([loadThread(selectedChat), refreshChats()]);
  } catch {
    setStatus(threadStatus, 'Unable to send message.');
  } finally {
    sendButton.disabled = false;
  }
});

refreshChats();
window.setInterval(pollForUpdates, POLL_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollForUpdates();
});
