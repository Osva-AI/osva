ALTER TABLE "batch_inference_jobs" ADD COLUMN "request_material_hash" text;
--> statement-breakpoint
ALTER TABLE "batch_inference_jobs" ADD COLUMN "pricing_snapshot_json" jsonb;
--> statement-breakpoint
UPDATE "batch_inference_jobs" SET "request_material_hash" = '' WHERE "request_material_hash" IS NULL;
--> statement-breakpoint
ALTER TABLE "batch_inference_jobs" ALTER COLUMN "request_material_hash" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "batch_inference_jobs" ALTER COLUMN "request_material_hash" SET DEFAULT '';