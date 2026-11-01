ALTER TABLE "media_assets" ADD COLUMN "thumbnail_storage_key" VARCHAR(500);

CREATE UNIQUE INDEX "media_assets_thumbnail_storage_key_key" ON "media_assets"("thumbnail_storage_key");
