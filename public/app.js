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

let selectedChat = null;

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
  chatList.replaceChildren();
  for (const chat of chats) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-button';
    button.dataset.chatId = chat.id;
    button.textContent = `${chat.title || 'Untitled chat'}${chat.unreadCount ? ` (${chat.unreadCount})` : ''}`;
    button.addEventListener('click', () => loadThread(chat));
    const preview = document.createElement('span');
    preview.className = 'preview';
    preview.textContent = chat.preview || '';
    item.append(button, preview);
    chatList.append(item);
  }
  if (chats.length === 0) chatList.textContent = 'No chats found.';
}

function renderMessages(messages) {
  messageList.replaceChildren();
  for (const message of messages) {
    const item = document.createElement('li');
    item.className = 'message';
    const sender = document.createElement('strong');
    sender.textContent = message.sender || 'Unknown';
    const text = document.createElement('p');
    text.textContent = message.text || '';
    const time = document.createElement('time');
    time.dateTime = message.timestamp || '';
    time.textContent = formatTimestamp(message.timestamp);
    item.append(sender, text, time);
    messageList.append(item);
  }
  if (messages.length === 0) messageList.textContent = 'No messages found.';
}

async function loadThread(chat) {
  selectedChat = chat;
  threadTitle.textContent = chat.title || 'Untitled chat';
  sendForm.hidden = false;
  setStatus(threadStatus, 'Loading messages…');
  messageList.replaceChildren();
  try {
    const data = await request(`/api/chats/${encodeURIComponent(chat.id)}/messages?limit=50`);
    renderMessages(data.items);
    setStatus(threadStatus, '');
  } catch {
    setStatus(threadStatus, 'Unable to load messages.');
  }
}

async function refreshChats() {
  setStatus(chatStatus, 'Loading chats…');
  try {
    const [chats, unread] = await Promise.all([request('/api/chats'), request('/api/unread-count')]);
    renderChats(chats.items);
    unreadCount.textContent = `Unread: ${unread.total}`;
    setStatus(chatStatus, '');
  } catch {
    setStatus(chatStatus, 'Unable to load chats.');
    unreadCount.textContent = 'Unread: unavailable';
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

sendForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!selectedChat || !text) return;
  if (!window.confirm(`Send this message to ${selectedChat.title || 'this chat'}?`)) return;
  const button = sendForm.querySelector('button');
  button.disabled = true;
  setStatus(threadStatus, 'Sending…');
  try {
    await request(`/api/chats/${encodeURIComponent(selectedChat.id)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        confirmed: true,
        clientMessageId: createClientMessageId(),
      }),
    });
    messageInput.value = '';
    await loadThread(selectedChat);
  } catch {
    setStatus(threadStatus, 'Unable to send message.');
  } finally {
    button.disabled = false;
  }
});

refreshChats();