/**
 * Reference to a secret stored outside normal OSVA records.
 * Concrete backends (.env, Vault, cloud secret stores) stay in adapters.
 */
export interface SecretReference {
  readonly key: string;
}
