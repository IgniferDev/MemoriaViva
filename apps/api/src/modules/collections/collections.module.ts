import { Module } from '@nestjs/common';
import { CollectionsController } from './collections.controller.js';
import { CollectionsService } from './collections.service.js';
import { MediaModule } from '../media/media.module.js';

@Module({
  controllers: [CollectionsController],
  imports: [MediaModule],
  providers: [CollectionsService],
})
export class CollectionsModule {}
