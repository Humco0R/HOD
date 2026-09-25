export type Actionability = 'ACTIONABLE' | 'NOT_ACTIONABLE' | 'UNCERTAIN';
export type DeadlineKind = 'EXACT_DATETIME' | 'DATE_ONLY' | 'RELATIVE' | 'DEPENDENCY' | 'UNKNOWN';
export type ExpectedResultType = 'PHOTO' | 'FILE' | 'TEXT' | 'NONE' | 'UNKNOWN';

export interface DetectionCandidate {
  classification: Actionability;
  title: string | null;
  assigneeReference: string | null;
  deadlineKind: DeadlineKind;
  deadlineAt: string | null;
  deadlineDate: string | null;
  deadlineDependency: string | null;
  deadlineRaw: string | null;
  expectedResultType: ExpectedResultType;
  expectedResultText: string | null;
  location: string | null;
  confidence: number;
  raw: Record<string, unknown>;
}

export interface DetectionContextMessage {
  messageId: string;
  senderMaxUserId: string;
  timestamp: string;
  text: string | null;
}

export interface DetectionJob {
  sourceMode: 'GROUP_CHAT' | 'PERSONAL_FORWARD';
  assignmentStrategy: 'RESOLVE_FROM_TEXT' | 'SOURCE_AUTHOR';
  proposalTarget: { type: 'CHAT' | 'USER'; externalId: string };
  workspaceId: string;
  chatId: string;
  externalChatId: string;
  sourceMessageId: string;
  sourceSenderId: string;
  sourceSenderExternalId: string;
  occurredAt: string;
  text: string | null;
  attachmentMetadata: Record<string, unknown>[];
  context: DetectionContextMessage[];
}

export interface DetectionMemberProfile {
  externalUserId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

export interface DetectionWorkspaceContext {
  timezone: string;
  members: DetectionMemberProfile[];
}

export interface AiDetectionInput extends DetectionWorkspaceContext {
  job: DetectionJob;
}
