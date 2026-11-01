import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { MediaStorage } from './media-storage.js';

@Injectable()
export class LocalMediaStorageService implements MediaStorage {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(process.cwd(), config.get('MEDIA_ROOT') ?? 'uploads');
  }

  async put(key: string, buffer: Buffer): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: 'wx' });
  }

  open(key: string) {
    return createReadStream(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }

  private pathFor(key: string): string {
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root + '\\') && !target.startsWith(this.root + '/')) {
      throw new Error('Invalid media storage key');
    }
    return target;
  }
}
