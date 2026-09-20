CREATE TYPE "ChunkingStrategy" AS ENUM ('LEGACY_SECTION', 'PAGE');

ALTER TABLE "IomVersion"
ADD COLUMN "chunkingStrategy" "ChunkingStrategy" NOT NULL DEFAULT 'LEGACY_SECTION';

ALTER TABLE "IomVersion"
ALTER COLUMN "chunkingStrategy" SET DEFAULT 'PAGE';
