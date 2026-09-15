export async function run(): Promise<{ readonly fn: () => number }> {
  return {
    fn: () => 1,
  };
}
