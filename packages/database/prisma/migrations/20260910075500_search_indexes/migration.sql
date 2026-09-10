CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "IomVersion_title_trgm_idx"
ON "IomVersion" USING GIN ("title" gin_trgm_ops);

CREATE INDEX "IomVersion_number_trgm_idx"
ON "IomVersion" USING GIN ("iomNumber" gin_trgm_ops);

CREATE INDEX "IomChunk_text_search_idx"
ON "IomChunk" USING GIN (to_tsvector('simple', "text"));
