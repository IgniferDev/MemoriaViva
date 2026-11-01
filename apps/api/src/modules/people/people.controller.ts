import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { CreatePersonDto } from './dto/create-person.dto.js';
import { UpdatePersonDto } from './dto/update-person.dto.js';
import { PeopleService } from './people.service.js';

type SessionRequest = Request & { user: AuthenticatedUser };

@Controller('people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get()
  findAll(@Req() request: SessionRequest) { return this.people.findAll(request.user.id); }

  @Post()
  create(@Req() request: SessionRequest, @Body() dto: CreatePersonDto) { return this.people.create(request.user.id, dto.name); }

  @Patch(':id')
  update(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdatePersonDto) {
    return this.people.update(request.user.id, id, dto.name);
  }

  @Delete(':id')
  remove(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.people.remove(request.user.id, id);
  }
}
