/** @type {import("../../../modules/sdk/index").ExtensionMain} */
const extension = {
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
        // Optional layout colours; a palette without them gets derived ones.
        chrome: "#1a1d32",
        chat: "#111322",
        bubble: "#20243c",
        "row-pinned": "#242842",
        selection: "#b9b5ff",
        "selection-text": "#18152e",
        "rail-icon": "#c0c7e7",
      },
    });
  },
};

export default extension;
