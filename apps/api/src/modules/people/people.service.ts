import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class PeopleService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(userId: string) {
    return this.prisma.person.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, name: string) {
    const normalized = name.trim();
    const existing = await this.prisma.person.findFirst({
      where: { ownerId: userId, name: { equals: normalized, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (existing) return existing;
    return this.prisma.person.create({
      data: { name: normalized, ownerId: userId },
      select: { id: true, name: true },
    });
  }

  async update(userId: string, id: string, name: string) {
    const normalized = name.trim();
    const person = await this.prisma.person.findFirst({ where: { id, ownerId: userId }, select: { id: true } });
    if (!person) throw new NotFoundException('Persona no encontrada');
    const duplicate = await this.prisma.person.findFirst({
      where: { ownerId: userId, id: { not: id }, name: { equals: normalized, mode: 'insensitive' } },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('Ya tienes una persona guardada con ese nombre.');
    return this.prisma.person.update({ where: { id }, data: { name: normalized }, select: { id: true, name: true } });
  }

  async remove(userId: string, id: string) {
    const person = await this.prisma.person.findFirst({ where: { id, ownerId: userId }, select: { id: true } });
    if (!person) throw new NotFoundException('Persona no encontrada');
    await this.prisma.$transaction(async (transaction) => {
      await transaction.eventPerson.deleteMany({ where: { personId: id, event: { ownerId: userId } } });
      await transaction.narration.updateMany({ where: { speakerId: id, event: { ownerId: userId } }, data: { speakerId: null } });
      await transaction.person.delete({ where: { id } });
    });
    return { id, deleted: true };
  }
}
