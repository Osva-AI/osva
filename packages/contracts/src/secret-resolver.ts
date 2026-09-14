import type { SecretReference } from "./secret-reference.js";

export type { SecretReference } from "./secret-reference.js";

export interface SecretResolver {
  resolve(secretReference: SecretReference): Promise<string>;
}
