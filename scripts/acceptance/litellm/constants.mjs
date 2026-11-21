/** Pinned LiteLLM Proxy image for OSVA acceptance (not `latest`). */
export const LITELLM_PROXY_IMAGE =
  "docker.litellm.ai/berriai/litellm:main-v1.63.11-stable";

/** Immutable digest recorded at acceptance lock time (main-v1.63.11-stable). */
export const LITELLM_PROXY_IMAGE_DIGEST =
  "sha256:27c487bc6b4e15f0c09016679c65cbe82d533e42c613c951de743d658f41485d";

/** Loopback-only publish; LiteLLM listens on 4000 inside the container. */
export const LITELLM_CONTAINER_PORT = 4000;

/** Acceptance-only master key (never a production secret). */
export const LITELLM_ACCEPTANCE_MASTER_KEY = "sk-osva-litellm-acceptance";

export const ACCEPTANCE_LABEL = "osva.acceptance.litellm";
export const ACCEPTANCE_RUN_LABEL = "osva.acceptance.litellm.run";

export const MODEL_ALIASES = [
  "osva-litellm-primary",
  "gpt-routing-test",
  "gpt-routing-cheap",
  "gpt-routing-retry-429",
  "gpt-test-snapshot",
  "litellm-proxy-retry-risk",
];
