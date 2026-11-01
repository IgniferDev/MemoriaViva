import { Module } from '@nestjs/common';
import { LocalMediaStorageService } from './local-media-storage.service.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { MEDIA_STORAGE } from './media-storage.js';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    LocalMediaStorageService,
    { provide: MEDIA_STORAGE, useExisting: LocalMediaStorageService },
  ],
  exports: [MediaService],
})
export class MediaModule {}
