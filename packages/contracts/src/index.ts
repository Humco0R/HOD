import { z } from 'zod';

export const serviceInfoSchema = z.object({
  name: z.literal('ХОД'),
  status: z.literal('bootstrap'),
  version: z.string(),
});

export type ServiceInfo = z.infer<typeof serviceInfoSchema>;

export const actionStatusSchema = z.enum([
  'NEW',
  'ACCEPTED',
  'IN_PROGRESS',
  'BLOCKED',
  'DONE',
  'VERIFIED',
  'CANCELLED',
]);
export const deadlineKindSchema = z.enum([
  'EXACT_DATETIME',
  'DATE_ONLY',
  'RELATIVE',
  'DEPENDENCY',
  'UNKNOWN',
]);
export const expectedResultTypeSchema = z.enum(['PHOTO', 'FILE', 'TEXT', 'NONE', 'UNKNOWN']);
export const userSummarySchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  username: z.string().nullable(),
});
export const attentionReasonSchema = z.enum([
  'OVERDUE',
  'BLOCKED',
  'AWAITING_VERIFICATION',
  'DUE_TODAY',
]);
export const actionSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: actionStatusSchema,
  deadlineKind: deadlineKindSchema,
  deadlineAt: z.iso.datetime().nullable(),
  deadlineDate: z.iso.date().nullable(),
  deadlineDependency: z.string().nullable(),
  deadlineRaw: z.string().nullable(),
  location: z.string().nullable(),
  expectedResultType: expectedResultTypeSchema,
  expectedResultText: z.string().nullable(),
  creator: userSummarySchema,
  assignee: userSummarySchema,
  attentionReasons: z.array(attentionReasonSchema),
  updatedAt: z.iso.datetime(),
});
export const actionListResponseSchema = z.object({ actions: z.array(actionSummarySchema) });
export const sourceContextMessageSchema = z.object({
  messageId: z.string(),
  senderMaxUserId: z.string(),
  timestamp: z.iso.datetime(),
  text: z.string().nullable(),
});
export const actionEventSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  fromStatus: actionStatusSchema.nullable(),
  toStatus: actionStatusSchema,
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const attachmentSchema = z.object({
  id: z.uuid(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  downloadUrl: z.string(),
  createdAt: z.iso.datetime(),
});
export const actionDetailSchema = actionSummarySchema.extend({
  description: z.string().nullable(),
  sourceContext: z.array(sourceContextMessageSchema),
  events: z.array(actionEventSchema),
  attachments: z.array(attachmentSchema),
});
export const transitionActionRequestSchema = z.object({
  command: z.enum([
    'ACCEPT',
    'START',
    'BLOCK',
    'UNBLOCK',
    'SUBMIT_RESULT',
    'VERIFY',
    'RETURN',
    'CANCEL',
  ]),
  reason: z.string().max(2_000).optional(),
  idempotencyKey: z.string().min(1).max(200),
});
export const createActionRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).nullable(),
    deadlineKind: z.enum(['UNKNOWN', 'DATE_ONLY', 'EXACT_DATETIME']),
    deadlineDate: z.iso.date().nullable(),
    deadlineAt: z.iso.datetime().nullable(),
    idempotencyKey: z.uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.deadlineKind === 'DATE_ONLY' && !value.deadlineDate) {
      context.addIssue({ code: 'custom', path: ['deadlineDate'], message: 'Required' });
    }
    if (value.deadlineKind === 'EXACT_DATETIME' && !value.deadlineAt) {
      context.addIssue({ code: 'custom', path: ['deadlineAt'], message: 'Required' });
    }
  });
export const createActionResponseSchema = z.object({
  id: z.uuid(),
  created: z.boolean(),
});
export const currentUserSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  externalUserId: z.string(),
});
export const detectionEditSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    assigneeId: z.uuid(),
    deadlineKind: deadlineKindSchema,
    deadlineAt: z.iso.datetime().nullable(),
    deadlineDate: z.iso.date().nullable(),
    deadlineDependency: z.string().trim().max(500).nullable(),
    deadlineRaw: z.string().trim().max(500).nullable(),
    expectedResultType: expectedResultTypeSchema,
    expectedResultText: z.string().trim().max(1_000).nullable(),
    location: z.string().trim().max(500).nullable(),
  })
  .superRefine((value, context) => {
    if (value.deadlineKind === 'EXACT_DATETIME' && !value.deadlineAt) {
      context.addIssue({ code: 'custom', path: ['deadlineAt'], message: 'Required' });
    }
    if (value.deadlineKind === 'DATE_ONLY' && !value.deadlineDate) {
      context.addIssue({ code: 'custom', path: ['deadlineDate'], message: 'Required' });
    }
    if (value.deadlineKind === 'DEPENDENCY' && !value.deadlineDependency) {
      context.addIssue({ code: 'custom', path: ['deadlineDependency'], message: 'Required' });
    }
  });
export const detectionDetailSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  assigneeId: z.uuid().nullable(),
  deadlineKind: deadlineKindSchema,
  deadlineAt: z.iso.datetime().nullable(),
  deadlineDate: z.iso.date().nullable(),
  deadlineDependency: z.string().nullable(),
  deadlineRaw: z.string().nullable(),
  expectedResultType: expectedResultTypeSchema,
  expectedResultText: z.string().nullable(),
  location: z.string().nullable(),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED']),
  members: z.array(userSummarySchema),
});

export type ActionSummary = z.infer<typeof actionSummarySchema>;
export type ActionDetail = z.infer<typeof actionDetailSchema>;
export type TransitionActionRequestDto = z.infer<typeof transitionActionRequestSchema>;
export type CreateActionRequestDto = z.infer<typeof createActionRequestSchema>;
export type CreateActionResponseDto = z.infer<typeof createActionResponseSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type DetectionEdit = z.infer<typeof detectionEditSchema>;
export type DetectionDetail = z.infer<typeof detectionDetailSchema>;
