export interface AttachmentUploadContext {
  workspaceId: string;
  actionId: string;
  uploaderId: string;
}

export interface StoredAttachment {
  id: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
}

export interface AttachmentStore {
  getUploadContext(actionId: string, userId: string): Promise<AttachmentUploadContext | null>;
  create(input: {
    context: AttachmentUploadContext;
    storageKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
  }): Promise<{ id: string }>;
  removeOwn(actionId: string, attachmentId: string, userId: string): Promise<string | null>;
  getForDownload(attachmentId: string, userId: string): Promise<StoredAttachment | null>;
}
