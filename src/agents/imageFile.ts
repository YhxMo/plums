import type { Attachment } from "../../modules/agents/contract";
import { LIMITS } from "../../modules/agents/attachments";

type Picture = Extract<Attachment, { kind: "image" }>;

/** Longest side sent to a model; larger pictures gain nothing but cost. */
const SIDE = 1568;
const SOURCE = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** Avatars are cropped square at this side and kept under this many base64 characters. */
export const AVATAR_SIDE = 256;
export const AVATAR_BASE64 = 36_000;
/** Largest file read at all, before scaling. */
const MAX_FILE = 25_000_000;

function encode(canvas: HTMLCanvasElement, mime: string, quality: number) {
  return new Promise<string>((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== mime)
          return reject(new Error("unsupported"));
        const reader = new FileReader();
        reader.onload = () =>
          resolve(
            String(reader.result).slice(String(reader.result).indexOf(",") + 1),
          );
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      },
      mime,
      quality,
    ),
  );
}

/**
 * A picture scaled to fit `side` and encoded under the per-picture limit,
 * as WebP where the browser can write it, else JPEG. A GIF gives its first
 * frame. `crop` takes the centred square instead of keeping the shape.
 */
export async function scaledPicture(
  file: File,
  { side = SIDE, limit = LIMITS.image as number, crop = false } = {},
): Promise<Pick<Picture, "mime" | "data">> {
  if (!SOURCE.includes(file.type))
    throw new Error(
      `图片「${file.name}」格式不支持，请用 PNG、JPEG、WebP 或 GIF。`,
    );
  if (file.size > MAX_FILE) throw new Error(`图片「${file.name}」太大。`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`无法读取图片「${file.name}」。`);
  }
  try {
    const edge = crop ? Math.min(bitmap.width, bitmap.height) : 0;
    const source = crop
      ? {
          x: (bitmap.width - edge) / 2,
          y: (bitmap.height - edge) / 2,
          w: edge,
          h: edge,
        }
      : { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
    const scale = Math.min(1, side / Math.max(source.w, source.h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.w * scale));
    canvas.height = Math.max(1, Math.round(source.h * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`无法处理图片「${file.name}」。`);
    context.drawImage(
      bitmap,
      source.x,
      source.y,
      source.w,
      source.h,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    for (const mime of ["image/webp", "image/jpeg"] as const)
      for (const quality of [0.85, 0.7, 0.5, 0.3]) {
        let data: string;
        try {
          data = await encode(canvas, mime, quality);
        } catch {
          break;
        }
        if (data.length <= limit) return { mime, data };
      }
    throw new Error(`图片「${file.name}」压缩后仍然太大。`);
  } finally {
    bitmap.close();
  }
}
