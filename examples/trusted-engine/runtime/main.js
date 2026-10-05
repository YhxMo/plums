export function activate(sdk) {
  sdk.register("commands", "start", () => sdk.engine.start("local"));
  sdk.register("commands", "status", () => sdk.engine.status("local"));
  sdk.register("commands", "run", (input) =>
    sdk.engine.request("local", "run", input, input.requestId),
  );
  sdk.register("commands", "cancel", (input) =>
    sdk.engine.cancel("local", input.requestId),
  );
  sdk.register("commands", "stop", () => sdk.engine.stop("local"));
}
