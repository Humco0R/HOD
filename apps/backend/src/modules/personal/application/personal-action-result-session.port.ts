export type PersonalActionResultStep = 'OFFER' | 'PHOTO' | 'FILE' | 'COMMENT' | 'REVIEW' | 'EDIT';

export interface PersonalActionResultMaterial {
  id: string;
  name: string;
  kind: 'PHOTO' | 'FILE';
}

export interface PersonalActionResultSession {
  id: string;
  actionId: string;
  step: PersonalActionResultStep;
  inputReturnStep: 'OFFER' | 'EDIT';
  reviewReturnStep: 'OFFER' | 'EDIT';
  comments: string[];
  materials: PersonalActionResultMaterial[];
  lastHandledMessageId: string | null;
}

export interface PersonalActionResultSessionStore {
  get(externalUserId: string): Promise<PersonalActionResultSession | null>;
  set(externalUserId: string, session: PersonalActionResultSession): Promise<void>;
  clear(externalUserId: string): Promise<void>;
}
