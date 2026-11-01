import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateEventDto } from './dto/create-event.dto.js';
import { UpdateEventDto } from './dto/update-event.dto.js';
import { serializeBigInt } from '../../common/serialize-bigint.js';
import { MediaService } from '../media/media.service.js';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async findAll(userId: string, collectionId?: string, search?: string) {
    const term = search?.trim();
    const events = await this.prisma.event.findMany({
      where: {
        ownerId: userId,
        ...(collectionId ? { collectionItems: { some: { collectionId } } } : {}),
        ...(term
          ? {
              OR: [
                { title: { contains: term, mode: 'insensitive' } },
                { description: { contains: term, mode: 'insensitive' } },
                { people: { some: { person: { name: { contains: term, mode: 'insensitive' } } } } },
                {
                  narrations: {
                    some: {
                      OR: [
                        { title: { contains: term, mode: 'insensitive' } },
                        { transcript: { contains: term, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ dateStart: 'asc' }, { createdAt: 'desc' }],
      include: {
        photos: { orderBy: { position: 'asc' }, include: { asset: true } },
        narrations: { orderBy: { position: 'asc' }, include: { speaker: true } },
        people: { include: { person: true } },
        collectionItems: { orderBy: { position: 'asc' }, select: { collectionId: true } },
      },
    });
    return serializeBigInt(events);
  }

  async findOne(userId: string, id: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, ownerId: userId },
      include: {
        photos: { orderBy: { position: 'asc' }, include: { asset: true } },
        narrations: {
          orderBy: { position: 'asc' },
          include: { speaker: true, audioAsset: true, relatedPhotoAsset: true },
        },
        people: { include: { person: true } },
        collectionItems: {
          include: { collection: true },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!event) throw new NotFoundException('Recuerdo no encontrado');
    return serializeBigInt(event);
  }

  async create(userId: string, dto: CreateEventDto) {
    const { collectionId, ...eventFields } = dto;
    const collection = await this.prisma.collection.findFirst({
      where: { id: collectionId, ownerId: userId },
      select: { id: true },
    });
    if (!collection) throw new NotFoundException('Colección no encontrada');
    await this.ensurePeopleBelongToUser(userId, eventFields.personIds ?? []);

    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.collectionItem.aggregate({
        where: { collectionId },
        _max: { position: true },
      });
      return transaction.event.create({
        data: {
          ...this.toCreateData(eventFields),
          owner: { connect: { id: userId } },
          collectionItems: {
            create: {
              position: (current._max.position ?? -1) + 1,
              collection: { connect: { id: collectionId } },
            },
          },
        },
      });
    });
  }

  async update(userId: string, id: string, dto: UpdateEventDto) {
    await this.ensureExists(userId, id);
    const { collectionId: _collectionId, ...eventFields } = dto;
    if (eventFields.personIds !== undefined) await this.ensurePeopleBelongToUser(userId, eventFields.personIds);
    return this.prisma.event.update({
      where: { id },
      data: this.toUpdateData(eventFields),
    });
  }

  async remove(userId: string, id: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, ownerId: userId },
      select: {
        photos: { select: { assetId: true } },
        narrations: { select: { audioAssetId: true } },
      },
    });
    if (!event) throw new NotFoundException('Recuerdo no encontrado');
    await this.prisma.event.delete({ where: { id } });
    const assetIds = new Set([
      ...event.photos.map((photo) => photo.assetId),
      ...event.narrations.map((narration) => narration.audioAssetId),
    ]);
    for (const assetId of assetIds) await this.media.removeAssetWhenUnused(assetId);
    return { id, deleted: true };
  }

  private toCreateData(fields: Omit<CreateEventDto, 'collectionId'>): Prisma.EventCreateInput {
    return {
      title: fields.title,
      description: fields.description,
      dateStart: this.parseDate(fields.dateStart),
      locationName: fields.locationName,
      ...(fields.personIds?.length
        ? {
            people: {
              create: fields.personIds.map((personId) => ({ person: { connect: { id: personId } } })),
            },
          }
        : {}),
    };
  }

  private toUpdateData(fields: Omit<UpdateEventDto, 'collectionId'>): Prisma.EventUpdateInput {
    return {
      title: fields.title,
      description: fields.description,
      dateStart: fields.dateStart === undefined
        ? undefined
        : fields.dateStart === null
          ? null
          : new Date(fields.dateStart),
      locationName: fields.locationName,
      ...(fields.personIds !== undefined
        ? {
            people: {
              deleteMany: {},
              create: fields.personIds.map((personId) => ({ person: { connect: { id: personId } } })),
            },
          }
        : {}),
    };
  }

  private parseDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined || value === null) return value;
    return new Date(value);
  }

  private async ensurePeopleBelongToUser(userId: string, personIds: string[]): Promise<void> {
    if (!personIds.length) return;
    const count = await this.prisma.person.count({ where: { id: { in: personIds }, ownerId: userId } });
    if (count !== new Set(personIds).size) throw new BadRequestException('Una persona seleccionada no está disponible.');
  }

  private async ensureExists(userId: string, id: string): Promise<void> {
    const exists = await this.prisma.event.findFirst({
      where: { id, ownerId: userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Recuerdo no encontrado');
  }
}
