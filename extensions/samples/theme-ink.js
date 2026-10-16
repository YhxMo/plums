/** @type {import("../../modules/sdk/index").ExtensionDefinition} */
const extension = {
  manifest: {
    id: "sample.theme-ink",
    version: "0.1.0",
    apiVersion: 1,
  },
  activate(ctx) {
    ctx.theme({
      id: "sample.ink",
      label: "墨夜",
      appearance: "dark",
      colors: {
        text: "#f2f3ff",
        muted: "#c0c7e7",
        background: "#111322",
        surface: "#181b30",
        card: "#20243c",
        overlay: "#282d47",
        subtle: "#2e3452",
        border: "#414965",
        "control-border": "#8290b8",
        accent: "#b9b5ff",
        "accent-hover": "#cecbff",
        "accent-ink": "#18152e",
        "accent-soft": "#38365f",
        "accent-text": "#d1caff",
        error: "#ffb9c4",
        running: "#a9dac2",
        shadow: "#04071599",
      },
    });
  },
};

export default extension;
