import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
} from "@opentelemetry/sdk-trace-base";

export function createTraceSampler(
  name: string | undefined,
  arg: string | undefined,
): Sampler | undefined {
  if (name === undefined || name.length === 0) {
    return undefined;
  }

  switch (name.trim().toLowerCase()) {
    case "always_on":
      return new AlwaysOnSampler();
    case "always_off":
      return new AlwaysOffSampler();
    case "traceidratio":
      return new TraceIdRatioBasedSampler(parseSamplerRatio(arg));
    case "parentbased_always_on":
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
    case "parentbased_always_off":
      return new ParentBasedSampler({ root: new AlwaysOffSampler() });
    case "parentbased_traceidratio":
      return new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(parseSamplerRatio(arg)),
      });
    default:
      return undefined;
  }
}

function parseSamplerRatio(arg: string | undefined): number {
  if (arg === undefined || arg.trim().length === 0) {
    return 1;
  }

  const parsed = Number.parseFloat(arg);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 1;
  }

  return Math.min(parsed, 1);
}
