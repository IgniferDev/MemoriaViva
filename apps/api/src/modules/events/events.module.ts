import { Module } from '@nestjs/common';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';
import { MediaModule } from '../media/media.module.js';

@Module({
  controllers: [EventsController],
  imports: [MediaModule],
  providers: [EventsService],
})
export class EventsModule {}
