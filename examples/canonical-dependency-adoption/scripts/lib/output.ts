export function printSetupHeader(): void {
  console.log("OSVA Canonical Dependency Adoption Setup");
  console.log("");
}

export function printStep(message: string): void {
  console.log(`✓ ${message}`);
}

export function printInfo(message: string): void {
  console.log(message);
}

export function printFailure(message: string): void {
  console.error(`✗ ${message}`);
}
