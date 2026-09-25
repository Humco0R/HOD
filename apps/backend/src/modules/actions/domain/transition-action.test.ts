import { describe, expect, it } from 'vitest';

import { ActionTransitionError } from './action-errors';
import { transitionAction } from './transition-action';
import type { ActionActor, ActionCommand, ActionLifecycleState, ActionStatus } from './action';

const assignee: ActionActor = { isAssignee: true, isCreator: false };
const creator: ActionActor = { isAssignee: false, isCreator: true };

const cases: Array<{
  command: ActionCommand;
  from: ActionStatus;
  to: ActionStatus;
  actor: ActionActor;
  blockedFromStatus?: 'ACCEPTED' | 'IN_PROGRESS';
  reason?: string;
}> = [
  { command: 'ACCEPT', from: 'NEW', to: 'ACCEPTED', actor: assignee },
  { command: 'START', from: 'ACCEPTED', to: 'IN_PROGRESS', actor: assignee },
  {
    command: 'BLOCK',
    from: 'ACCEPTED',
    to: 'BLOCKED',
    actor: assignee,
    reason: 'Нет детали',
  },
  {
    command: 'UNBLOCK',
    from: 'BLOCKED',
    to: 'ACCEPTED',
    actor: assignee,
    blockedFromStatus: 'ACCEPTED',
  },
  { command: 'SUBMIT_RESULT', from: 'IN_PROGRESS', to: 'DONE', actor: assignee },
  { command: 'VERIFY', from: 'DONE', to: 'VERIFIED', actor: creator },
  {
    command: 'RETURN',
    from: 'DONE',
    to: 'IN_PROGRESS',
    actor: creator,
    reason: 'Фото не подтверждает результат',
  },
  { command: 'CANCEL', from: 'IN_PROGRESS', to: 'CANCELLED', actor: creator },
  { command: 'CANCEL', from: 'VERIFIED', to: 'CANCELLED', actor: creator },
];

describe('transitionAction', () => {
  it.each(cases)('$command transitions $from to $to', (testCase) => {
    const action: ActionLifecycleState = {
      status: testCase.from,
      blockedFromStatus: testCase.blockedFromStatus ?? null,
    };

    expect(
      transitionAction({
        action,
        actor: testCase.actor,
        command: testCase.command,
        ...(testCase.reason ? { reason: testCase.reason } : {}),
      }).nextStatus,
    ).toBe(testCase.to);
  });

  it('remembers IN_PROGRESS when blocking and restores it when unblocking', () => {
    const blocked = transitionAction({
      action: { status: 'IN_PROGRESS', blockedFromStatus: null },
      actor: assignee,
      command: 'BLOCK',
      reason: 'Жду доступ',
    });

    expect(blocked.blockedFromStatus).toBe('IN_PROGRESS');
    expect(
      transitionAction({
        action: { status: blocked.nextStatus, blockedFromStatus: blocked.blockedFromStatus },
        actor: assignee,
        command: 'UNBLOCK',
      }).nextStatus,
    ).toBe('IN_PROGRESS');
  });

  it('rejects invalid transitions', () => {
    expect(() =>
      transitionAction({
        action: { status: 'NEW', blockedFromStatus: null },
        actor: assignee,
        command: 'START',
      }),
    ).toThrowError(ActionTransitionError);
  });

  it('does not delete a result while it awaits review', () => {
    expectActionError(
      () =>
        transitionAction({
          action: { status: 'DONE', blockedFromStatus: null },
          actor: creator,
          command: 'CANCEL',
        }),
      'INVALID_TRANSITION',
    );
  });

  it('rejects an unauthorized actor', () => {
    expectActionError(
      () =>
        transitionAction({
          action: { status: 'DONE', blockedFromStatus: null },
          actor: assignee,
          command: 'VERIFY',
        }),
      'FORBIDDEN',
    );
  });

  it('does not allow an assignee who is not the creator to delete an action', () => {
    expectActionError(
      () =>
        transitionAction({
          action: { status: 'IN_PROGRESS', blockedFromStatus: null },
          actor: assignee,
          command: 'CANCEL',
        }),
      'FORBIDDEN',
    );
  });

  it.each(['BLOCK', 'RETURN'] as const)('requires a reason for %s', (command) => {
    expectActionError(
      () =>
        transitionAction({
          action: { status: command === 'BLOCK' ? 'IN_PROGRESS' : 'DONE', blockedFromStatus: null },
          actor: command === 'BLOCK' ? assignee : creator,
          command,
          reason: '  ',
        }),
      'REASON_REQUIRED',
    );
  });
});

function expectActionError(invoke: () => unknown, code: ActionTransitionError['code']): void {
  try {
    invoke();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  expect.fail(`Expected ${code}`);
}
