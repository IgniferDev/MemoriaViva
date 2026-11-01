import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class UpdateNarrationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsUUID('4')
  speakerId?: string | null;

  @IsOptional()
  @IsUUID('4')
  relatedPhotoAssetId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  transcript?: string | null;
}
