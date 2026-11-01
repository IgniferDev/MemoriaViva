import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import sharp from 'sharp';
import { AssetKind } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MEDIA_STORAGE, type MediaStorage } from './media-storage.js';
import { serializeBigInt } from '../../common/serialize-bigint.js';
import { UpdateNarrationDto } from './dto/update-narration.dto.js';

export type IncomingMediaFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const photoTypes: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const audioTypes: Record<string, string> = {
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
};

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  async addPhoto(userId: string, eventId: string, file: IncomingMediaFile, caption?: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId, ownerId: userId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Recuerdo no encontrado');
    const asset = await this.saveAsset(file, AssetKind.PHOTO, photoTypes);
    try {
      const max = await this.prisma.eventPhoto.aggregate({
        where: { eventId },
        _max: { position: true },
      });
      const photo = await this.prisma.eventPhoto.create({
        data: {
          eventId,
          assetId: asset.id,
          position: (max._max.position ?? -1) + 1,
          caption: caption?.trim().slice(0, 300) || null,
        },
        include: { asset: true },
      });
      return serializeBigInt(photo);
    } catch (error) {
      await this.prisma.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
      await this.storage.delete(asset.storageKey);
      throw error;
    }
  }

  async addNarration(
    userId: string,
    eventId: string,
    file: IncomingMediaFile,
    input: { title?: string; speaker?: string; transcript?: string; relatedPhotoAssetId?: string },
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId, ownerId: userId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Recuerdo no encontrado');
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('La narración necesita un título');

    const asset = await this.saveAsset(file, AssetKind.AUDIO, audioTypes);
    try {
      const max = await this.prisma.narration.aggregate({
        where: { eventId },
        _max: { position: true },
      });
      const speakerName = input.speaker?.trim();
      if (input.relatedPhotoAssetId) {
        if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(input.relatedPhotoAssetId)) {
          throw new BadRequestException('El identificador de foto no es válido');
        }
        const relatedPhoto = await this.prisma.eventPhoto.findFirst({
          where: { eventId, assetId: input.relatedPhotoAssetId },
          select: { id: true },
        });
        if (!relatedPhoto) throw new BadRequestException('La foto relacionada no pertenece a este recuerdo');
      }
      let speaker = speakerName
        ? await this.prisma.person.findFirst({
            where: { ownerId: userId, name: { equals: speakerName, mode: 'insensitive' } },
          })
        : null;
      if (speakerName && !speaker) {
        speaker = await this.prisma.person.create({ data: { ownerId: userId, name: speakerName } });
      }
      const narration = await this.prisma.narration.create({
        data: {
          eventId,
          audioAssetId: asset.id,
          speakerId: speaker?.id,
          title: title.slice(0, 200),
          transcript: input.transcript?.trim() || null,
          relatedPhotoAssetId: input.relatedPhotoAssetId || null,
          position: (max._max.position ?? -1) + 1,
        },
        include: { audioAsset: true, speaker: true, relatedPhotoAsset: true },
      });
      return serializeBigInt(narration);
    } catch (error) {
      await this.prisma.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
      await this.storage.delete(asset.storageKey);
      throw error;
    }
  }

  async removePhoto(userId: string, eventId: string, photoId: string) {
    const photo = await this.prisma.eventPhoto.findFirst({
      where: { id: photoId, eventId, event: { ownerId: userId } },
      select: { id: true, assetId: true },
    });
    if (!photo) throw new NotFoundException('Fotografía no encontrada');
    await this.prisma.eventPhoto.delete({ where: { id: photoId } });
    await this.removeAssetWhenUnused(photo.assetId);
    return { id: photoId, deleted: true };
  }

  async updateCaption(userId: string, eventId: string, photoId: string, caption?: string) {
    const photo = await this.prisma.eventPhoto.findFirst({ where: { id: photoId, eventId, event: { ownerId: userId } }, select: { id: true } });
    if (!photo) throw new NotFoundException('Fotografía no encontrada');
    return serializeBigInt(await this.prisma.eventPhoto.update({
      where: { id: photoId },
      data: { caption: caption?.trim().slice(0, 300) || null },
      include: { asset: true },
    }));
  }

  async reorderPhotos(userId: string, eventId: string, ids: string[]) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, ownerId: userId }, select: { id: true } });
    if (!event) throw new NotFoundException('Recuerdo no encontrado');
    const current = await this.prisma.eventPhoto.findMany({ where: { eventId }, select: { id: true, assetId: true } });
    const currentIds = new Set(current.map((photo) => photo.id));
    if (ids.length !== currentIds.size || ids.some((id) => !currentIds.has(id))) {
      throw new BadRequestException('La lista debe contener exactamente las fotografías del recuerdo');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.eventPhoto.deleteMany({ where: { eventId } });
      if (ids.length) await tx.eventPhoto.createMany({ data: ids.map((id, position) => ({ id, eventId, position, assetId: current.find((photo) => photo.id === id)!.assetId })) });
      return tx.eventPhoto.findMany({ where: { eventId }, orderBy: { position: 'asc' } });
    });
  }

  async reorderNarrations(userId: string, eventId: string, ids: string[]) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, ownerId: userId }, select: { id: true } });
    if (!event) throw new NotFoundException('Recuerdo no encontrado');
    const current = await this.prisma.narration.findMany({ where: { eventId }, select: { id: true } });
    const currentIds = new Set(current.map((voice) => voice.id));
    if (ids.length !== currentIds.size || ids.some((id) => !currentIds.has(id))) {
      throw new BadRequestException('La lista debe contener exactamente las narraciones del recuerdo');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.narration.updateMany({ where: { eventId }, data: { position: { increment: 100000 } } });
      for (const [position, id] of ids.entries()) await tx.narration.update({ where: { id }, data: { position } });
    });
    return this.prisma.narration.findMany({
      where: { eventId }, orderBy: { position: 'asc' },
      include: { audioAsset: true, speaker: true, relatedPhotoAsset: true },
    }).then(serializeBigInt);
  }

  async updateNarration(userId: string, eventId: string, narrationId: string, input: UpdateNarrationDto) {
    const narration = await this.prisma.narration.findFirst({
      where: { id: narrationId, eventId, event: { ownerId: userId } },
      select: { id: true },
    });
    if (!narration) throw new NotFoundException('Narración no encontrada');

    const title = input.title?.trim();
    if (input.title !== undefined && !title) throw new BadRequestException('La narración necesita un título');
    if (input.speakerId) {
      const speaker = await this.prisma.person.findFirst({ where: { id: input.speakerId, ownerId: userId }, select: { id: true } });
      if (!speaker) throw new BadRequestException('La persona seleccionada no existe');
    }
    if (input.relatedPhotoAssetId) {
      const photo = await this.prisma.eventPhoto.findFirst({ where: { eventId, assetId: input.relatedPhotoAssetId }, select: { id: true } });
      if (!photo) throw new BadRequestException('La foto relacionada no pertenece a este recuerdo');
    }

    const updated = await this.prisma.narration.update({
      where: { id: narrationId },
      data: {
        ...(input.title !== undefined ? { title: title!.slice(0, 200) } : {}),
        ...(input.speakerId !== undefined ? { speakerId: input.speakerId } : {}),
        ...(input.relatedPhotoAssetId !== undefined ? { relatedPhotoAssetId: input.relatedPhotoAssetId } : {}),
        ...(input.transcript !== undefined ? { transcript: input.transcript?.trim() || null } : {}),
      },
      include: { audioAsset: true, speaker: true, relatedPhotoAsset: true },
    });
    return serializeBigInt(updated);
  }

  async removeNarration(userId: string, eventId: string, narrationId: string) {
    const narration = await this.prisma.narration.findFirst({
      where: { id: narrationId, eventId, event: { ownerId: userId } },
      select: { id: true, audioAssetId: true },
    });
    if (!narration) throw new NotFoundException('Narración no encontrada');
    await this.prisma.narration.delete({ where: { id: narrationId } });
    await this.removeAssetWhenUnused(narration.audioAssetId);
    return { id: narrationId, deleted: true };
  }

  async addCollectionCover(userId: string, collectionId: string, file: IncomingMediaFile) {
    const collection = await this.prisma.collection.findFirst({
      where: { id: collectionId, ownerId: userId },
      select: { id: true, coverAssetId: true },
    });
    if (!collection) throw new NotFoundException('Colección no encontrada');
    const asset = await this.saveAsset(file, AssetKind.PHOTO, photoTypes);
    try {
      const updated = await this.prisma.collection.update({
        where: { id: collection.id },
        data: { coverAssetId: asset.id },
        include: { coverAsset: true },
      });
      if (collection.coverAssetId) await this.removeAssetWhenUnused(collection.coverAssetId);
      return serializeBigInt(updated);
    } catch (error) {
      await this.removeAssetWhenUnused(asset.id);
      throw error;
    }
  }

  async removeCollectionCover(userId: string, collectionId: string) {
    const collection = await this.prisma.collection.findFirst({
      where: { id: collectionId, ownerId: userId },
      select: { id: true, coverAssetId: true },
    });
    if (!collection) throw new NotFoundException('Colección no encontrada');
    if (!collection.coverAssetId) return { collectionId, removed: false };
    await this.prisma.collection.update({ where: { id: collectionId }, data: { coverAssetId: null } });
    await this.removeAssetWhenUnused(collection.coverAssetId);
    return { collectionId, removed: true };
  }

  async content(userId: string, assetId: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Archivo no encontrado');
    await this.ensureAssetBelongsToUser(userId, assetId);
    return { asset, stream: this.storage.open(asset.storageKey) };
  }

  async thumbnail(userId: string, assetId: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Archivo no encontrado');
    await this.ensureAssetBelongsToUser(userId, assetId);
    if (asset.kind !== AssetKind.PHOTO && asset.kind !== AssetKind.THUMBNAIL) {
      throw new BadRequestException('El archivo no es una fotografía');
    }
    const key = asset.thumbnailStorageKey ?? asset.storageKey;
    return { asset, stream: this.storage.open(key), mimeType: asset.thumbnailStorageKey ? 'image/webp' : asset.mimeType };
  }

  private async ensureAssetBelongsToUser(userId: string, assetId: string): Promise<void> {
    const [photo, audio, relatedPhoto, cover] = await Promise.all([
      this.prisma.eventPhoto.findFirst({ where: { assetId, event: { ownerId: userId } }, select: { id: true } }),
      this.prisma.narration.findFirst({ where: { audioAssetId: assetId, event: { ownerId: userId } }, select: { id: true } }),
      this.prisma.narration.findFirst({ where: { relatedPhotoAssetId: assetId, event: { ownerId: userId } }, select: { id: true } }),
      this.prisma.collection.findFirst({ where: { coverAssetId: assetId, ownerId: userId }, select: { id: true } }),
    ]);
    if (!photo && !audio && !relatedPhoto && !cover) throw new NotFoundException('Archivo no encontrado');
  }

  private async saveAsset(
    file: IncomingMediaFile | undefined,
    kind: AssetKind,
    allowed: Record<string, string>,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Selecciona un archivo');
    const mimeType = file.mimetype.split(';')[0].trim();
    const extension = allowed[mimeType];
    if (!extension) throw new BadRequestException('El formato del archivo no está permitido');
    const id = randomUUID();
    const storageKey = `${kind === AssetKind.PHOTO ? 'photos' : 'audio'}/${id}${extension}`;
    const originalName = basename(file.originalname).slice(0, 255) || `archivo${extname(extension)}`;
    await this.storage.put(storageKey, file.buffer);
    let thumbnailStorageKey: string | undefined;
    if (kind === AssetKind.PHOTO) {
      try {
        const thumbnail = await sharp(file.buffer)
          .rotate()
          .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
        thumbnailStorageKey = `thumbnails/${id}.webp`;
        await this.storage.put(thumbnailStorageKey, thumbnail);
      } catch {
        await this.storage.delete(storageKey);
        throw new BadRequestException('No se pudo procesar la fotografía');
      }
    }
    try {
      return await this.prisma.mediaAsset.create({
        data: {
          id,
          kind,
          storageKey,
          thumbnailStorageKey,
          originalName,
          mimeType,
          sizeBytes: BigInt(file.size),
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
        },
      });
    } catch (error) {
      await this.storage.delete(storageKey);
      if (thumbnailStorageKey) await this.storage.delete(thumbnailStorageKey);
      throw error;
    }
  }

  async removeAssetWhenUnused(assetId: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
      include: { _count: { select: { eventPhotos: true, narrationAudio: true, narrationPhoto: true, pageElements: true, collectionCover: true } } },
    });
    if (!asset) return;
    const references = asset._count.eventPhotos + asset._count.narrationAudio + asset._count.narrationPhoto + asset._count.pageElements + asset._count.collectionCover;
    if (references) return;
    await this.prisma.mediaAsset.delete({ where: { id: assetId } });
    await this.storage.delete(asset.storageKey);
    if (asset.thumbnailStorageKey) await this.storage.delete(asset.thumbnailStorageKey);
  }
}
