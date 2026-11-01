import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReorderCollectionEventsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  eventIds!: string[];
}
