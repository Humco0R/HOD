import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AttachmentStore, LocalProofStorage } from '../../modules/attachments';
import {
  MaxPersonalResultMaterialGateway,
  parseMaxAttachment,
} from './max-personal-result-material.gateway';

afterEach(() => vi.unstubAllGlobals());

describe('MaxPersonalResultMaterialGateway', () => {
  it('accepts MAX media URLs and rejects external URLs', () => {
    expect(
      parseMaxAttachment(
        { type: 'file', filename: '../result.pdf', payload: { url: 'https://fu.oneme.ru/file' } },
        'FILE',
      ),
    ).toEqual({ url: 'https://fu.oneme.ru/file', name: 'result.pdf' });
    expect(
      parseMaxAttachment(
        { type: 'file', filename: 'bad', payload: { url: 'https://evil.example/file' } },
        'FILE',
      ),
    ).toBeNull();
    expect(
      parseMaxAttachment({ type: 'image', payload: { url: 'http://i.oneme.ru/photo' } }, 'PHOTO'),
    ).toBeNull();
  });

  it('downloads and saves an attached file under the action', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('proof', { headers: { 'content-type': 'text/plain' } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const create = vi.fn(() => Promise.resolve({ id: 'attachment-1' }));
    const write = vi.fn(() =>
      Promise.resolve({ storageKey: 'stored', sizeBytes: 5, checksumSha256: 'hash' }),
    );
    const gateway = new MaxPersonalResultMaterialGateway(
      {
        getUploadContext: () =>
          Promise.resolve({ workspaceId: 'workspace', actionId: 'action', uploaderId: 'user' }),
        create,
      } as unknown as AttachmentStore,
      { write, delete: vi.fn() } as unknown as LocalProofStorage,
      10,
    );

    const saved = await gateway.save({
      actionId: 'action',
      userId: 'user',
      kind: 'FILE',
      attachment: {
        type: 'file',
        filename: 'result.txt',
        payload: { url: 'https://fu.oneme.ru/file' },
      },
    });

    expect(saved).toEqual({ id: 'attachment-1', name: 'result.txt', kind: 'FILE' });
    expect(write).toHaveBeenCalledWith({
      workspaceId: 'workspace',
      actionId: 'action',
      content: Buffer.from('proof'),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ originalName: 'result.txt', mimeType: 'text/plain' }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects oversized downloads before writing to storage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('too much'))),
    );
    const write = vi.fn();
    const gateway = new MaxPersonalResultMaterialGateway(
      {
        getUploadContext: () =>
          Promise.resolve({ workspaceId: 'workspace', actionId: 'action', uploaderId: 'user' }),
      } as unknown as AttachmentStore,
      { write } as unknown as LocalProofStorage,
      3,
    );
    await expect(
      gateway.save({
        actionId: 'action',
        userId: 'user',
        kind: 'PHOTO',
        attachment: { type: 'image', payload: { url: 'https://i.oneme.ru/photo' } },
      }),
    ).rejects.toThrow('too large');
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a redirect to an untrusted host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
        ),
      ),
    );
    const write = vi.fn();
    const gateway = new MaxPersonalResultMaterialGateway(
      {
        getUploadContext: () =>
          Promise.resolve({ workspaceId: 'workspace', actionId: 'action', uploaderId: 'user' }),
      } as unknown as AttachmentStore,
      { write } as unknown as LocalProofStorage,
      10,
    );
    await expect(
      gateway.save({
        actionId: 'action',
        userId: 'user',
        kind: 'PHOTO',
        attachment: { type: 'image', payload: { url: 'https://i.oneme.ru/photo' } },
      }),
    ).rejects.toThrow('Untrusted MAX media URL');
    expect(write).not.toHaveBeenCalled();
  });
});
