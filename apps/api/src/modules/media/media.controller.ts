import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AuthenticatedUser } from '../auth/auth.types.js';
import { MediaService, type IncomingMediaFile } from './media.service.js';
import { ReorderMediaDto } from './dto/reorder-media.dto.js';
import { UpdateNarrationDto } from './dto/update-narration.dto.js';

const photoTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const audioTypes = new Set(['audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg']);
type SessionRequest = Request & { user: AuthenticatedUser };

@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('events/:eventId/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  addPhoto(@Req() request: SessionRequest, @Param('eventId', new ParseUUIDPipe()) eventId: string, @UploadedFile() file: IncomingMediaFile | undefined, @Body('caption') caption?: string) {
    this.assertType(file, photoTypes);
    return this.media.addPhoto(request.user.id, eventId, file!, caption);
  }

  @Patch('events/:eventId/photos/order')
  reorderPhotos(@Req() request: SessionRequest, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Body() dto: ReorderMediaDto) {
    return this.media.reorderPhotos(request.user.id, eventId, dto.ids);
  }

  @Patch('events/:eventId/photos/:photoId')
  updateCaption(@Req() request: SessionRequest, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('photoId', new ParseUUIDPipe()) photoId: string, @Body('caption') caption?: string) {
    return this.media.updateCaption(request.user.id, eventId, photoId, caption);
  }

  @Delete('events/:eventId/photos/:photoId')
  removePhoto(@Req() request: SessionRequest, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('photoId', new ParseUUIDPipe()) photoId: string) {
    return this.media.removePhoto(request.user.id, eventId, photoId);
  }

  @Post('events/:eventId/narrations')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  addNarration(
    @Req() request: SessionRequest,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @UploadedFile() file: IncomingMediaFile | undefined,
    @Body('title') title?: string,
    @Body('speaker') speaker?: string,
    @Body('transcript') transcript?: string,
    @Body('relatedPhotoAssetId') relatedPhotoAssetId?: string,
  ) {
    this.assertType(file, audioTypes);
    return this.media.addNarration(request.user.id, eventId, file!, { title, speaker, transcript, relatedPhotoAssetId });
  }

  @Patch('events/:eventId/narrations/order')
  reorderNarrations(@Req() request: SessionRequest, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Body() dto: ReorderMediaDto) {
    return this.media.reorderNarrations(request.user.id, eventId, dto.ids);
  }

  @Patch('events/:eventId/narrations/:narrationId')
  updateNarration(
    @Req() request: SessionRequest,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('narrationId', new ParseUUIDPipe()) narrationId: string,
    @Body() dto: UpdateNarrationDto,
  ) {
    return this.media.updateNarration(request.user.id, eventId, narrationId, dto);
  }

  @Delete('events/:eventId/narrations/:narrationId')
  removeNarration(@Req() request: SessionRequest, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('narrationId', new ParseUUIDPipe()) narrationId: string) {
    return this.media.removeNarration(request.user.id, eventId, narrationId);
  }

  @Post('collections/:collectionId/cover')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  addCollectionCover(@Req() request: SessionRequest, @Param('collectionId', new ParseUUIDPipe()) collectionId: string, @UploadedFile() file: IncomingMediaFile | undefined) {
    this.assertType(file, photoTypes);
    return this.media.addCollectionCover(request.user.id, collectionId, file!);
  }

  @Delete('collections/:collectionId/cover')
  removeCollectionCover(@Req() request: SessionRequest, @Param('collectionId', new ParseUUIDPipe()) collectionId: string) {
    return this.media.removeCollectionCover(request.user.id, collectionId);
  }

  @Get('media/assets/:id/content')
  async content(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) response: Response) {
    const { asset, stream } = await this.media.content(request.user.id, id);
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Content-Length', asset.sizeBytes.toString());
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    return new StreamableFile(stream);
  }

  @Get('media/assets/:id/thumbnail')
  async thumbnail(@Req() request: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) response: Response) {
    const { stream, mimeType } = await this.media.thumbnail(request.user.id, id);
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    return new StreamableFile(stream);
  }

  private assertType(file: IncomingMediaFile | undefined, types: Set<string>) {
    if (!file) throw new BadRequestException('Selecciona un archivo');
    if (!types.has(file.mimetype.split(';')[0].trim())) throw new BadRequestException('El formato del archivo no está permitido');
  }
}
