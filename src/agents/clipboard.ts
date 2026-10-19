/** Copies text, falling back to a hidden selection where the async API is refused. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    const focused = document.activeElement as HTMLElement | null;
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    focused?.focus();
    if (!copied) throw new Error("无法复制，请手动选择文本。");
  }
}
