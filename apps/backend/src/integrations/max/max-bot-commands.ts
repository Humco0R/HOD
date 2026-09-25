import type { Bot } from '@maxhub/max-bot-api';
import type { BotCommand } from '@maxhub/max-bot-api/types';

const startCommand: BotCommand = {
  name: 'start',
  description: 'Открыть главное меню',
};

export async function ensureStartCommand(
  api: Pick<Bot['api'], 'setMyCommands'>,
  existingCommands: BotCommand[] | null | undefined,
): Promise<boolean> {
  const commands = existingCommands ?? [];
  if (commands.some((command) => command.name === startCommand.name)) return false;
  await api.setMyCommands([...commands, startCommand]);
  return true;
}
