import { ActionTransitionError } from './action-errors';
import type {
  ActionCommand,
  ActionEventType,
  ActionStatus,
  ActionTransition,
  ActionTransitionInput,
} from './action';

const assigneeCommands = new Set<ActionCommand>([
  'ACCEPT',
  'START',
  'BLOCK',
  'UNBLOCK',
  'SUBMIT_RESULT',
]);
const creatorCommands = new Set<ActionCommand>(['VERIFY', 'RETURN', 'CANCEL']);

interface TransitionDefinition {
  from: readonly ActionStatus[];
  to: ActionStatus | 'BLOCKED_PREVIOUS';
  eventType: ActionEventType;
  reasonRequired?: boolean;
}

const definitions: Record<ActionCommand, TransitionDefinition> = {
  ACCEPT: { from: ['NEW'], to: 'ACCEPTED', eventType: 'ACTION_ACCEPTED' },
  START: { from: ['ACCEPTED'], to: 'IN_PROGRESS', eventType: 'ACTION_STARTED' },
  BLOCK: {
    from: ['ACCEPTED', 'IN_PROGRESS'],
    to: 'BLOCKED',
    eventType: 'ACTION_BLOCKED',
    reasonRequired: true,
  },
  UNBLOCK: { from: ['BLOCKED'], to: 'BLOCKED_PREVIOUS', eventType: 'ACTION_UNBLOCKED' },
  SUBMIT_RESULT: { from: ['IN_PROGRESS'], to: 'DONE', eventType: 'RESULT_SUBMITTED' },
  VERIFY: { from: ['DONE'], to: 'VERIFIED', eventType: 'RESULT_ACCEPTED' },
  RETURN: {
    from: ['DONE'],
    to: 'IN_PROGRESS',
    eventType: 'RESULT_REJECTED',
    reasonRequired: true,
  },
  CANCEL: {
    from: ['NEW', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'VERIFIED'],
    to: 'CANCELLED',
    eventType: 'ACTION_CANCELLED',
  },
};

export function transitionAction(input: ActionTransitionInput): ActionTransition {
  assertAuthorized(input);
  const definition = definitions[input.command];

  if (!definition.from.includes(input.action.status)) {
    throw new ActionTransitionError(
      'INVALID_TRANSITION',
      `${input.command} is not allowed from ${input.action.status}`,
    );
  }

  const reason = input.reason?.trim() || null;
  if (definition.reasonRequired && !reason) {
    throw new ActionTransitionError('REASON_REQUIRED', `${input.command} requires a reason`);
  }

  const nextStatus = resolveNextStatus(input, definition);

  return {
    previousStatus: input.action.status,
    nextStatus,
    blockedFromStatus:
      input.command === 'BLOCK'
        ? (input.action.status as 'ACCEPTED' | 'IN_PROGRESS')
        : nextStatus === 'BLOCKED'
          ? input.action.blockedFromStatus
          : null,
    eventType: definition.eventType,
    reason,
  };
}

function assertAuthorized(input: ActionTransitionInput): void {
  if (assigneeCommands.has(input.command) && !input.actor.isAssignee) {
    throw new ActionTransitionError('FORBIDDEN', 'Only the assignee can execute this command');
  }
  if (creatorCommands.has(input.command) && !input.actor.isCreator) {
    throw new ActionTransitionError('FORBIDDEN', 'Only the creator can execute this command');
  }
}

function resolveNextStatus(
  input: ActionTransitionInput,
  definition: TransitionDefinition,
): ActionStatus {
  if (definition.to !== 'BLOCKED_PREVIOUS') return definition.to;
  if (
    input.action.blockedFromStatus !== 'ACCEPTED' &&
    input.action.blockedFromStatus !== 'IN_PROGRESS'
  ) {
    throw new ActionTransitionError(
      'INVALID_TRANSITION',
      'Blocked action has no valid prior status',
    );
  }
  return input.action.blockedFromStatus;
}
