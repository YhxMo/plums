export function activate(sdk) {
  sdk.register("commands", "probe", async ({ method, input }) => {
    await sdk.engine.start("local");
    return sdk.engine.request("local", method, input);
  });
}
