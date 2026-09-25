import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export class LocalProofStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async write(input: {
    workspaceId: string;
    actionId: string;
    content: Buffer;
  }): Promise<{ storageKey: string; sizeBytes: number; checksumSha256: string }> {
    const storageKey = `${input.workspaceId}/${input.actionId}/${randomUUID()}`;
    const path = this.resolveKey(storageKey);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, input.content, { flag: 'wx' });
    return {
      storageKey,
      sizeBytes: input.content.byteLength,
      checksumSha256: createHash('sha256').update(input.content).digest('hex'),
    };
  }

  read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveKey(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await unlink(this.resolveKey(storageKey)).catch(() => undefined);
  }

  private resolveKey(storageKey: string): string {
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(`${this.root}${sep}`)) throw new Error('Invalid proof storage key');
    return path;
  }
}
