/** Small DOM helpers owned by these examples; no runtime SDK dependency. */
/**
 * @template {keyof HTMLElementTagNameMap} T
 * @param {T} tag
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[T]}
 */
export function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {import("./local-proof-types.js").ViewScope} scope
 * @param {EventTarget} target
 * @param {string} type
 * @param {EventListener} handler
 */
export function listen(scope, target, type, handler) {
  scope.onDispose(() => target.removeEventListener(type, handler));
  target.addEventListener(type, handler);
}

/**
 * @param {HTMLElement} root
 * @param {import("./local-proof-types.js").ViewScope} scope
 * @param {string} title
 * @param {string} description
 */
export function panel(root, scope, title, description) {
  const node = element("section");
  scope.onDispose(() => node.remove());
  Object.assign(node.style, {
    padding: "clamp(12px, 3vw, 20px)",
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "880px",
    margin: "0 auto",
    lineHeight: "1.65",
    color: "inherit",
    overflowWrap: "anywhere",
  });
  const heading = element("h2", title);
  heading.tabIndex = -1;
  Object.assign(heading.style, { margin: "0 0 8px", fontSize: "24px" });
  node.append(heading);
  if (description) node.append(element("p", description));
  root.append(node);
  return node;
}

/** @param {string} text */
export function action(text) {
  const node = element("button", text);
  node.type = "button";
  Object.assign(node.style, {
    color: "inherit",
    backgroundColor: "transparent",
    border: "1px solid var(--control-border, currentColor)",
    borderRadius: "6px",
    padding: "8px 12px",
    minHeight: "44px",
    cursor: "pointer",
    font: "inherit",
  });
  return node;
}
