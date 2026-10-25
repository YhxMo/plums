import type { Agent } from "@modules/agents/contract";
import { withRoleCard } from "@modules/agents/card-export";
import { bytesToBase64 } from "@modules/agents/card-png";
import { plumSvg } from "./plum";

/** The side of an exported card's picture, in pixels. */
const SIDE = 512;

function load(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取头像。"));
    image.src = src;
  });
}

/** The Agent's picture, or its plum, as a square PNG. */
async function picture(agent: Pick<Agent, "name" | "avatar">) {
  const url =
    agent.avatar ??
    URL.createObjectURL(
      new Blob([plumSvg(agent.name)], { type: "image/svg+xml" }),
    );
  try {
    const image = await load(url);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIDE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法生成角色卡图片。");
    // Cover the square, centred, as the avatar is shown.
    const scale = SIDE / Math.min(image.width, image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    context.drawImage(image, (SIDE - w) / 2, (SIDE - h) / 2, w, h);
    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, "image/png"),
    );
    if (!blob) throw new Error("无法生成角色卡图片。");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    if (!agent.avatar) URL.revokeObjectURL(url);
  }
}

/** A file name from the Agent's name, without characters folders use. */
export const fileName = (name: string, extension: string) =>
  `${name.replace(/[/\\:\0]/g, "_").replace(/^\.+/, "") || "Agent"}${extension}`;

/** The Agent as a picture role card: its file name and base64 bytes. */
export async function roleCardFile(agent: Agent) {
  const png = withRoleCard(await picture(agent), agent);
  return { name: fileName(agent.name, ".png"), data: bytesToBase64(png) };
}
