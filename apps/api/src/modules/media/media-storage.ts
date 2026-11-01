import type { ReadStream } from 'node:fs';

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

export interface MediaStorage {
  put(key: string, buffer: Buffer): Promise<void>;
  open(key: string): ReadStream;
  delete(key: string): Promise<void>;
}
