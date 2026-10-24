/** @type {import("../../../modules/sdk/index").ExtensionMain} */
export default {
  activate(ctx) {
    ctx.theme({
      id: "sample.ocean",
      label: "海湾",
      appearance: "light",
      colors: {
        text: "#143B36",
        muted: "#47665F",
        background: "#F5FAF8",
        surface: "#FFFFFF",
        card: "#FFFFFF",
        overlay: "#FFFFFF",
        subtle: "#EAF2EF",
        border: "#CFDED7",
        "control-border": "#69877D",
        accent: "#176B63",
        "accent-hover": "#12594F",
        "accent-ink": "#FFFFFF",
        "accent-soft": "#E1F3EE",
        "accent-text": "#135E56",
        error: "#A52C38",
        running: "#2C6E46",
        shadow: "#12372D26",
      },
    });
  },
};
