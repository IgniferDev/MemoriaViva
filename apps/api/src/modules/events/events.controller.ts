import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateEventDto } from './dto/create-event.dto.js';
import { UpdateEventDto } from './dto/update-event.dto.js';
import { EventsService } from './events.service.js';

type SessionRequest = Request & { user: AuthenticatedUser };

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  findAll(
    @Req() request: SessionRequest,
    @Query('collectionId', new ParseUUIDPipe({ optional: true }))
    collectionId?: string,
    @Query('search') search?: string,
  ) {
    return this.eventsService.findAll(request.user.id, collectionId, search);
  }

  @Post()
  create(@Req() request: SessionRequest, @Body() dto: CreateEventDto) {
    return this.eventsService.create(request.user.id, dto);
  }

  @Get(':id')
  findOne(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.findOne(request.user.id, id);
  }

  @Patch(':id')
  update(
    @Req() request: SessionRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(request.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.remove(request.user.id, id);
  }
}
