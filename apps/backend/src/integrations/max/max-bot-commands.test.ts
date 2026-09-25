import { describe, expect, it, vi } from 'vitest';

import { ensureStartCommand } from './max-bot-commands';

describe('ensureStartCommand', () => {
  it('adds /start while preserving registered commands', async () => {
    const setMyCommands = vi.fn().mockResolvedValue({ commands: [] });

    expect(
      await ensureStartCommand({ setMyCommands }, [{ name: 'help', description: 'Справка' }]),
    ).toBe(true);
    expect(setMyCommands).toHaveBeenCalledWith([
      { name: 'help', description: 'Справка' },
      { name: 'start', description: 'Открыть главное меню' },
    ]);
  });

  it('keeps an existing /start command without changing the list', async () => {
    const setMyCommands = vi.fn().mockResolvedValue({ commands: [] });

    expect(
      await ensureStartCommand({ setMyCommands }, [{ name: 'start', description: 'Начать' }]),
    ).toBe(false);
    expect(setMyCommands).not.toHaveBeenCalled();
  });
});
