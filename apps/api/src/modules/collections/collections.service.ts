import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateCollectionDto } from './dto/create-collection.dto.js';
import { UpdateCollectionDto } from './dto/update-collection.dto.js';
import { ReorderCollectionEventsDto } from './dto/reorder-collection-events.dto.js';
import { serializeBigInt } from '../../common/serialize-bigint.js';
import { MediaService } from '../media/media.service.js';

@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  async findAll(userId: string) {
    const collections = await this.prisma.collection.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { items: true } }, coverAsset: true },
    });
    return serializeBigInt(collections);
  }

  async findOne(userId: string, id: string) {
    const collection = await this.prisma.collection.findFirst({
      where: { id, ownerId: userId },
      include: {
        coverAsset: true,
        items: {
          orderBy: { position: 'asc' },
          include: {
            event: {
              include: {
                photos: { orderBy: { position: 'asc' }, include: { asset: true } },
                narrations: { orderBy: { position: 'asc' }, include: { audioAsset: true, speaker: true, relatedPhotoAsset: true } },
                people: { include: { person: true } },
              },
            },
          },
        },
      },
    });
    if (!collection) throw new NotFoundException('Colección no encontrada');
    return serializeBigInt(collection);
  }

  async create(userId: string, dto: CreateCollectionDto) {
    return serializeBigInt(await this.prisma.collection.create({
      data: { ...dto, ownerId: userId },
      include: { coverAsset: true },
    }));
  }

  async addEvent(userId: string, collectionId: string, eventId: string) {
    await this.ensureExists(userId, collectionId);
    const event = await this.prisma.event.findFirst({ where: { id: eventId, ownerId: userId }, select: { id: true } });
    if (!event) throw new NotFoundException('Recuerdo no encontrado');
    const existing = await this.prisma.collectionItem.findUnique({ where: { collectionId_eventId: { collectionId, eventId } } });
    if (existing) return existing;
    const lastItem = await this.prisma.collectionItem.aggregate({ where: { collectionId }, _max: { position: true } });
    return this.prisma.collectionItem.create({
      data: { collectionId, eventId, position: (lastItem._max.position ?? -1) + 1 },
    });
  }

  async removeEvent(userId: string, collectionId: string, eventId: string) {
    await this.ensureExists(userId, collectionId);
    await this.prisma.collectionItem.deleteMany({ where: { collectionId, eventId } });
    return { collectionId, eventId, removed: true };
  }

  async reorderEvents(userId: string, collectionId: string, dto: ReorderCollectionEventsDto) {
    await this.ensureExists(userId, collectionId);
    const currentItems = await this.prisma.collectionItem.findMany({ where: { collectionId }, select: { eventId: true } });
    const currentIds = new Set(currentItems.map((item) => item.eventId));
    if (dto.eventIds.length !== currentIds.size || dto.eventIds.some((eventId) => !currentIds.has(eventId))) {
      throw new NotFoundException('La lista debe contener exactamente los recuerdos de la colección');
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.collectionItem.deleteMany({ where: { collectionId } });
      await transaction.collectionItem.createMany({ data: dto.eventIds.map((eventId, position) => ({ collectionId, eventId, position })) });
      return transaction.collectionItem.findMany({ where: { collectionId }, orderBy: { position: 'asc' } });
    });
  }

  async update(userId: string, id: string, dto: UpdateCollectionDto) {
    await this.ensureExists(userId, id);
    return serializeBigInt(await this.prisma.collection.update({ where: { id }, data: dto, include: { coverAsset: true } }));
  }

  async remove(userId: string, id: string) {
    await this.ensureExists(userId, id);
    const collection = await this.prisma.collection.findUnique({ where: { id }, select: { coverAssetId: true } });
    await this.prisma.collection.delete({ where: { id } });
    if (collection?.coverAssetId) await this.media.removeAssetWhenUnused(collection.coverAssetId);
    return { id, deleted: true };
  }

  private async ensureExists(userId: string, id: string): Promise<void> {
    const exists = await this.prisma.collection.findFirst({ where: { id, ownerId: userId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Colección no encontrada');
  }
}
