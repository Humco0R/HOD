import { z } from 'zod';

const userSchema = z.object({
  user_id: z.number(),
  name: z.string(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().nullable().optional(),
  is_bot: z.boolean(),
  last_activity_time: z.number(),
});

const messageSchema = z.object({
  sender: userSchema.nullable().optional(),
  recipient: z.object({
    chat_id: z.number().nullable(),
    chat_type: z.enum(['dialog', 'chat', 'channel']),
    user_id: z.number().nullable().optional(),
    post_id: z.number().nullable().optional(),
  }),
  timestamp: z.number(),
  link: z
    .object({
      type: z.enum(['forward', 'reply']),
      sender: userSchema.nullable().optional(),
      chat_id: z.number().optional(),
      message: z.object({
        mid: z.string().min(1),
        seq: z.number(),
        text: z.string().nullable(),
        attachments: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
      }),
    })
    .nullable()
    .optional(),
  body: z
    .object({
      mid: z.string().min(1),
      seq: z.number(),
      text: z.string().nullable(),
      attachments: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    })
    .nullable(),
});

const eventBase = { timestamp: z.number() } as const;

export const supportedMaxUpdateSchema = z.discriminatedUnion('update_type', [
  z.object({
    ...eventBase,
    update_type: z.literal('bot_started'),
    chat_id: z.number(),
    user: userSchema,
    payload: z.string().nullable().optional(),
  }),
  z.object({
    ...eventBase,
    update_type: z.literal('bot_added'),
    chat_id: z.number(),
    user: userSchema,
    is_channel: z.boolean(),
  }),
  z.object({
    ...eventBase,
    update_type: z.literal('bot_removed'),
    chat_id: z.number(),
    user: userSchema,
    is_channel: z.boolean(),
  }),
  z.object({
    ...eventBase,
    update_type: z.literal('chat_title_changed'),
    chat_id: z.number(),
    user: userSchema,
    title: z.string(),
  }),
  z.object({
    ...eventBase,
    update_type: z.literal('user_added'),
    chat_id: z.number(),
    user: userSchema,
    inviter_id: z.number().nullable().optional(),
    is_channel: z.boolean(),
  }),
  z.object({
    ...eventBase,
    update_type: z.literal('user_removed'),
    chat_id: z.number(),
    user: userSchema,
    admin_id: z.number().nullable().optional(),
    is_channel: z.boolean(),
  }),
  z.object({ ...eventBase, update_type: z.literal('message_created'), message: messageSchema }),
  z.object({
    ...eventBase,
    update_type: z.literal('message_callback'),
    callback: z.object({
      timestamp: z.number(),
      callback_id: z.string().min(1),
      payload: z.string().optional(),
      user: userSchema,
    }),
    message: messageSchema.nullable().optional(),
  }),
]);

export const maxUpdateEnvelopeSchema = z.object({
  update_type: z.string().min(1),
  timestamp: z.number(),
});

export type SupportedMaxUpdate = z.infer<typeof supportedMaxUpdateSchema>;
