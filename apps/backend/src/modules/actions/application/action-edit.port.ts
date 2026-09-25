export interface UpdateActionTitleInput {
  actionId: string;
  actorUserId: string;
  title: string;
}

export interface UpdateActionDescriptionInput {
  actionId: string;
  actorUserId: string;
  description: string | null;
}

export interface UpdateActionLocationInput {
  actionId: string;
  actorUserId: string;
  location: string | null;
}

export interface UpdateActionDeadlineInput {
  actionId: string;
  actorUserId: string;
  deadlineKind: 'EXACT_DATETIME' | 'DATE_ONLY' | 'RELATIVE' | 'DEPENDENCY' | 'UNKNOWN';
  deadlineAt: Date | null;
  deadlineDate: string | null;
  deadlineDependency: string | null;
  deadlineRaw: string | null;
}

export interface ActionEditPort {
  updateTitle(input: UpdateActionTitleInput): Promise<boolean>;

  updateDescription(input: UpdateActionDescriptionInput): Promise<boolean>;

  updateLocation(input: UpdateActionLocationInput): Promise<boolean>;

  updateDeadline(input: UpdateActionDeadlineInput): Promise<boolean>;
}
