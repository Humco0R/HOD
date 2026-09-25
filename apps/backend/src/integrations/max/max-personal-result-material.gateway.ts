import type { AttachmentStore, LocalProofStorage } from '../../modules/attachments';
import type { PersonalResultMaterialPort } from '../../modules/personal';

const maxRedirects = 3;

export class MaxPersonalResultMaterialGateway implements PersonalResultMaterialPort {
  constructor(
    private readonly attachments: AttachmentStore,
    private readonly storage: LocalProofStorage,
    private readonly maxBytes: number,
  ) {}

  async save(input: {
    actionId: string;
    userId: string;
    kind: 'PHOTO' | 'FILE';
    attachment: Record<string, unknown>;
  }): Promise<{ id: string; name: string; kind: 'PHOTO' | 'FILE' }> {
    const context = await this.attachments.getUploadContext(input.actionId, input.userId);
    if (!context) throw new Error('Result attachment is not allowed for this action');
    const metadata = parseMaxAttachment(input.attachment, input.kind);
    if (!metadata) throw new Error('Unsupported MAX attachment');
    const downloaded = await downloadMaxAttachment(metadata.url, this.maxBytes);
    if (input.kind === 'PHOTO' && !downloaded.mimeType.startsWith('image/')) {
      throw new Error('MAX returned a non-image attachment');
    }
    const name = input.kind === 'PHOTO' ? photoFilename(downloaded.mimeType) : metadata.name;
    const stored = await this.storage.write({
      workspaceId: context.workspaceId,
      actionId: input.actionId,
      content: downloaded.content,
    });
    try {
      const created = await this.attachments.create({
        context,
        ...stored,
        originalName: name,
        mimeType: downloaded.mimeType,
      });
      return { id: created.id, name, kind: input.kind };
    } catch (error) {
      await this.storage.delete(stored.storageKey);
      throw error;
    }
  }

  async remove(input: { actionId: string; userId: string; materialId: string }): Promise<void> {
    const storageKey = await this.attachments.removeOwn(
      input.actionId,
      input.materialId,
      input.userId,
    );
    if (storageKey) await this.storage.delete(storageKey);
  }
}

export function parseMaxAttachment(
  attachment: Record<string, unknown>,
  kind: 'PHOTO' | 'FILE',
): { url: string; name: string } | null {
  if (attachment.type !== (kind === 'PHOTO' ? 'image' : 'file')) return null;
  const payload = attachment.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const url = (payload as Record<string, unknown>).url;
  if (typeof url !== 'string' || !isTrustedMaxMediaUrl(url)) return null;
  const filename = attachment.filename;
  const name =
    kind === 'PHOTO' ? 'Фото' : typeof filename === 'string' ? sanitizeFilename(filename) : 'Файл';
  return { url, name };
}

function isTrustedMaxMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['oneme.ru', 'okcdn.ru', 'max.ru'].some(
        (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

async function downloadMaxAttachment(
  url: string,
  maxBytes: number,
): Promise<{ content: Buffer; mimeType: string }> {
  let nextUrl = url;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    if (!isTrustedMaxMediaUrl(nextUrl)) throw new Error('Untrusted MAX media URL');
    const response = await fetch(nextUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('MAX media redirect has no location');
      nextUrl = new URL(location, nextUrl).href;
      continue;
    }
    if (!response.ok || !response.body) throw new Error('Could not download MAX attachment');
    const declaredSize = Number(response.headers.get('content-length'));
    if (declaredSize > maxBytes) {
      await response.body.cancel();
      throw new Error('MAX attachment is too large');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('MAX attachment is too large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (!size) throw new Error('MAX attachment is empty');
    const mimeType =
      response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
    if (mimeType === 'text/html') throw new Error('MAX returned HTML instead of an attachment');
    return { content: Buffer.concat(chunks), mimeType };
  }
  throw new Error('Too many MAX media redirects');
}

function sanitizeFilename(value: string): string {
  const filename = [...value.replace(/^.*[\\/]/, '')]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();
  return filename.slice(0, 255) || 'Файл';
}

function photoFilename(mimeType: string): string {
  const extension = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['image/heic', 'heic'],
    ['image/tiff', 'tiff'],
    ['image/bmp', 'bmp'],
  ]).get(mimeType);
  return `Фото.${extension ?? 'jpg'}`;
}
