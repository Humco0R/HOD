import { describe, expect, it, vi } from 'vitest';

import type {
  ChatDirectoryGateway,
  ChatDirectoryStore,
  ExternalChatSnapshot,
} from './chat-directory.port';
import { SynchronizeChatDirectoryUseCase } from './synchronize-chat-directory.usecase';

const snapshot: ExternalChatSnapshot = {
  externalChatId: '77',
  title: 'Монтажники',
  status: 'ACTIVE',
  botHasReadAccess: true,
  ownerExternalUserId: '42',
  members: [{ externalUserId: '42', firstName: 'Иван', lastName: null, username: 'ivan' }],
};

describe('SynchronizeChatDirectoryUseCase', () => {
  it('bootstraps one workspace per unknown chat using the bot-adder as owner', async () => {
    let known = false;
    const bootstrapChat = vi.fn(() => {
      known = true;
      return Promise.resolve({ workspaceId: 'workspace', chatId: 'chat' });
    });
    const activateMember = vi.fn(() => Promise.resolve());
    const store: ChatDirectoryStore = {
      findByExternalChatId: vi.fn(() =>
        Promise.resolve(known ? { workspaceId: 'workspace', chatId: 'chat' } : null),
      ),
      findParticipant: vi.fn(() => Promise.resolve(null)),
      bootstrapChat,
      activateMember,
      removeMember: vi.fn(() => Promise.resolve()),
      updateChat: vi.fn(() => Promise.resolve()),
    };
    const gateway: ChatDirectoryGateway = {
      getChatSnapshot: vi.fn(() => Promise.resolve(snapshot)),
    };
    const useCase = new SynchronizeChatDirectoryUseCase(store, gateway, 'Asia/Yekaterinburg');
    const actor = { externalUserId: '99', firstName: 'Ольга', lastName: null, username: null };

    await useCase.handle({
      kind: 'bot.added',
      eventId: 'bot.added:1:77:99',
      occurredAt: new Date(1),
      externalChatId: '77',
      actor,
    });

    expect(bootstrapChat).toHaveBeenCalledWith({
      snapshot,
      owner: actor,
      timezone: 'Asia/Yekaterinburg',
    });
    expect(activateMember).toHaveBeenCalledWith('77', actor);
  });
});
