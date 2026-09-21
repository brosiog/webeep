import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function numberFromTitle(title) {
  if (typeof title !== 'string') return '';
  const digits = title.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  const nonPhoneText = title.replace(/[\d+().\-\s]/g, '');
  return nonPhoneText.length === 0 ? `+${digits}` : '';
}

async function readLabels(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

export function createContactStore({ filePath }) {
  let labelsPromise;
  const labels = async () => {
    labelsPromise ??= readLabels(filePath);
    return labelsPromise;
  };

  async function save(nextLabels) {
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(nextLabels, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, filePath);
    labelsPromise = Promise.resolve(nextLabels);
  }

  return {
    async getLabels() {
      return { ...await labels() };
    },
    async getLabelsForChats(chats) {
      const savedLabels = await labels();
      const labelByNumber = { ...savedLabels };
      for (const contact of await this.list(chats)) {
        if (contact.name) labelByNumber[contact.number] = contact.name;
      }
      return labelByNumber;
    },
    async list(chats) {
      const savedLabels = await labels();
      const seenNumbers = new Set();
      const contacts = [];
      for (const chat of chats) {
        const directNumber = numberFromTitle(chat.title);
        const numbers = directNumber ? [directNumber] : (chat.participantPhoneNumbers ?? []);
        for (const number of numbers) {
          if (seenNumbers.has(number)) continue;
          seenNumbers.add(number);
          const isDirect = number === directNumber;
          contacts.push({
            id: number,
            chatId: isDirect ? chat.id : null,
            number,
            name: savedLabels[number] ?? savedLabels[chat.id] ?? '',
            preview: isDirect ? (chat.preview ?? '') : `${chat.title || 'Group chat'}: ${chat.preview ?? ''}`.trim(),
            unreadCount: chat.unreadCount ?? 0,
          });
        }
      }
      return contacts;
    },
    async setLabel(number, name) {
      const trimmed = name.trim();
      const nextLabels = { ...await labels() };
      if (trimmed) nextLabels[number] = trimmed;
      else delete nextLabels[number];
      await save(nextLabels);
    },
  };
}
