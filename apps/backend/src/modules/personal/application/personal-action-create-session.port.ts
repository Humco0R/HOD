export type PersonalCreateStep =
  | 'TITLE'
  | 'DESCRIPTION'
  | 'DEADLINE'
  | 'DEADLINE_DATE'
  | 'DEADLINE_DATETIME'
  | 'REVIEW'
  | 'EDIT';

export interface PersonalActionCreateSession {
  id: string;
  step: PersonalCreateStep;
  navigationStack: PersonalCreateStep[];
  lastHandledEventId: string | null;
  title: string | null;
  description: string | null;
  deadlineKind: 'UNKNOWN' | 'DATE_ONLY' | 'EXACT_DATETIME';
  deadlineDate: string | null;
  deadlineAt: string | null;
  deadlineRaw: string | null;
}

export interface PersonalActionCreateSessionStore {
  get(externalUserId: string): Promise<PersonalActionCreateSession | null>;
  set(externalUserId: string, session: PersonalActionCreateSession): Promise<void>;
  clear(externalUserId: string): Promise<void>;
}
