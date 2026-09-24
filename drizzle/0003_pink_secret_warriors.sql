-- Backfill before tightening the constraint.
--
-- These columns were nullable with no default and several writers never set
-- them, so existing rows can hold NULL. `SET NOT NULL` aborts if any NULL
-- remains, hence the UPDATEs below.
--
-- The real wall-clock time for these rows is unrecoverable, so they are stamped
-- with the Unix epoch rather than now(). That is deliberate: epoch sorts LAST
-- under `ORDER BY <col> DESC`, so a backfilled row can never masquerade as the
-- latest price/prediction, and it falls outside every `>= since` lookback
-- window so it is correctly treated as "no usable history" instead of as fresh
-- data. The rows are preserved rather than deleted — purge them separately if
-- you want the space back.
UPDATE "stockPrices"   SET "timestamp"   = '1970-01-01T00:00:00.000Z' WHERE "timestamp"   IS NULL;--> statement-breakpoint
UPDATE "predictions"   SET "timestamp"   = '1970-01-01T00:00:00.000Z' WHERE "timestamp"   IS NULL;--> statement-breakpoint
UPDATE "newsSentiment" SET "publishedAt" = '1970-01-01T00:00:00.000Z' WHERE "publishedAt" IS NULL;--> statement-breakpoint
UPDATE "newsSentiment" SET "createdAt"   = '1970-01-01T00:00:00.000Z' WHERE "createdAt"   IS NULL;--> statement-breakpoint
ALTER TABLE "newsSentiment" ALTER COLUMN "publishedAt" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "newsSentiment" ALTER COLUMN "createdAt" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "predictions" ALTER COLUMN "timestamp" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stockPrices" ALTER COLUMN "timestamp" SET NOT NULL;
