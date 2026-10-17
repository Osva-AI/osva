import type { UserId } from "@osva-ai/contracts";

import type { User } from "../user.js";

export interface UserRepository {
  save(user: User): Promise<void>;
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
}
