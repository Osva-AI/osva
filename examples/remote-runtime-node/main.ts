import { createNodeHttpServer, createRuntime } from "@osva/sdk/runtime";

const runtime = createRuntime({
  execute: async (input, context) => {
    if (
      typeof input === "object" &&
      input !== null &&
      "prompt" in input &&
      typeof input.prompt === "string"
    ) {
      const result = await context.models.generateText({
        binding: "primary",
        messages: [{ role: "user", content: input.prompt }],
      });
      return { text: result.text };
    }
    return input;
  },
});

const server = createNodeHttpServer(runtime);
const port = Number(process.env.PORT ?? "8080");
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `Node remote runtime listening on http://127.0.0.1:${String(port)}/execute\n`,
  );
});
