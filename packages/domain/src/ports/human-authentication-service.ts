import type { UserId } from "@osva-ai/contracts";

export interface HumanSignInWithEmailCommand {
  readonly email: string;
  readonly password: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface HumanSignInResult {
  readonly userId: UserId;
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly expiresAt: Date;
}

export interface HumanSessionSnapshot {
  readonly userId: UserId;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

export interface HumanAuthenticationService {
  signInWithEmail(
    command: HumanSignInWithEmailCommand,
  ): Promise<HumanSignInResult>;
  signOut(sessionToken: string): Promise<void>;
  getSession(sessionToken: string): Promise<HumanSessionSnapshot | null>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(input: {
    readonly token: string;
    readonly newPassword: string;
  }): Promise<void>;
  completeInitialSetup(input: {
    readonly userId: UserId;
    readonly displayName: string;
    readonly newPassword: string;
  }): Promise<void>;
  completeInitialSetupWithToken(input: {
    readonly token: string;
    readonly newPassword: string;
  }): Promise<void>;
}
