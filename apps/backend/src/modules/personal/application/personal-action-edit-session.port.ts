export type PersonalActionEditMode =
  | 'TITLE'
  | 'DESCRIPTION'
  | 'LOCATION'
  | 'DEADLINE_DATE'
  | 'DEADLINE_DATETIME';

export interface PersonalActionEditSession {
  actionId: string;
  mode: PersonalActionEditMode;
}

export interface PersonalActionEditSessionStore {
  get(externalUserId: string): Promise<PersonalActionEditSession | null>;

  set(externalUserId: string, session: PersonalActionEditSession): Promise<void>;

  clear(externalUserId: string): Promise<void>;
}
