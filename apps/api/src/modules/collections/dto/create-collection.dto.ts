import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CollectionKind } from '../../../generated/prisma/enums.js';

export class CreateCollectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsEnum(CollectionKind)
  kind!: CollectionKind;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;
}
