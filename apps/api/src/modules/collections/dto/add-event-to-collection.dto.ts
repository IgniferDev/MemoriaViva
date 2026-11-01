import { IsUUID } from 'class-validator';

export class AddEventToCollectionDto {
  @IsUUID()
  eventId!: string;
}
