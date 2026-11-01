import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CollectionsService } from './collections.service.js';
import { CreateCollectionDto } from './dto/create-collection.dto.js';
import { UpdateCollectionDto } from './dto/update-collection.dto.js';
import { AddEventToCollectionDto } from './dto/add-event-to-collection.dto.js';
import { ReorderCollectionEventsDto } from './dto/reorder-collection-events.dto.js';

type SessionRequest = Request & { user: AuthenticatedUser };

@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Get()
  findAll(@Req() request: SessionRequest) {
    return this.collectionsService.findAll(request.user.id);
  }

  @Post()
  create(@Req() request: SessionRequest, @Body() dto: CreateCollectionDto) {
    return this.collectionsService.create(request.user.id, dto);
  }

  @Post(':id/events')
  addEvent(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AddEventToCollectionDto) {
    return this.collectionsService.addEvent(request.user.id, id, dto.eventId);
  }

  @Delete(':id/events/:eventId')
  removeEvent(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string, @Param('eventId', new ParseUUIDPipe()) eventId: string) {
    return this.collectionsService.removeEvent(request.user.id, id, eventId);
  }

  @Patch(':id/events/order')
  reorderEvents(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ReorderCollectionEventsDto) {
    return this.collectionsService.reorderEvents(request.user.id, id, dto);
  }

  @Get(':id')
  findOne(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.collectionsService.findOne(request.user.id, id);
  }

  @Patch(':id')
  update(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateCollectionDto) {
    return this.collectionsService.update(request.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.collectionsService.remove(request.user.id, id);
  }
}
