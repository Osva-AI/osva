export interface InitTemplateVars {
  readonly agentKey: string;
  readonly agentName: string;
  readonly packageName: string;
  readonly entrypoint: string;
}

export interface InitSuccess {
  readonly ok: true;
  readonly projectName: string;
  readonly projectDir: string;
  readonly files: readonly string[];
}

export interface InitFailure {
  readonly ok: false;
  readonly error: string;
}

export type InitResult = InitSuccess | InitFailure;
