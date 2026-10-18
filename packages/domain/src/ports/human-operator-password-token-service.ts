export interface HumanOperatorPasswordToken {
  readonly token: string;
  readonly url: string;
}

export interface HumanOperatorPasswordTokenService {
  issuePasswordResetToken(input: {
    readonly email: string;
    readonly redirectTo: string;
  }): Promise<HumanOperatorPasswordToken>;
}
