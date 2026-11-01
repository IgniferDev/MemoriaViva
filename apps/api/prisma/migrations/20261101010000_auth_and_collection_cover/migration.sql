CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "birth_date" DATE NOT NULL,
    "country" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "collections"
ADD COLUMN "owner_id" UUID,
ADD COLUMN "cover_asset_id" UUID;

ALTER TABLE "events"
ADD COLUMN "owner_id" UUID;

ALTER TABLE "people"
ADD COLUMN "owner_id" UUID;

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "collections_cover_asset_id_key" ON "collections"("cover_asset_id");
CREATE INDEX "collections_owner_id_updated_at_idx" ON "collections"("owner_id", "updated_at");
CREATE INDEX "events_owner_id_idx" ON "events"("owner_id");
CREATE UNIQUE INDEX "people_owner_id_name_key" ON "people"("owner_id", "name");
CREATE INDEX "people_owner_id_idx" ON "people"("owner_id");

ALTER TABLE "collections"
ADD CONSTRAINT "collections_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "collections_cover_asset_id_fkey"
FOREIGN KEY ("cover_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "events"
ADD CONSTRAINT "events_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "people"
ADD CONSTRAINT "people_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
