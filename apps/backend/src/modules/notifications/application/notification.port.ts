export interface OutboundNotification {
  target: {
    type: 'CHAT' | 'USER';
    externalId: string;
  };

  text: string;

  hideMainMenu?: boolean;

  media?: {
    attachmentId: string;
    requesterUserId: string;
  };

  screen?: {
    key: string;
    replacePrevious: boolean;
  };

  buttons: Array<
    | {
        text: string;
        payload: string;
        startParam?: never;
        row?: number;
      }
    | {
        text: string;
        startParam: string;
        payload?: never;
        row?: number;
      }
  >;
}

export interface NotificationPublisher {
  publish(notification: OutboundNotification, idempotencyKey: string): Promise<void>;
}
