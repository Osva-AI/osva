ALTER TABLE "model_profile_versions" DROP CONSTRAINT "model_profile_versions_provider_check";--> statement-breakpoint
ALTER TABLE "model_profile_versions" ADD CONSTRAINT "model_profile_versions_provider_check" CHECK ("provider" in ('OPENAI', 'ANTHROPIC', 'GOOGLE_GEMINI'));
