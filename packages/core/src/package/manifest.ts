import type { ErrorObject } from "ajv";
import { FORMAT_UNSUPPORTED, MANIFEST_INVALID, PlumsError } from "../errors.js";
import { FORMAT_VERSION_PATTERN, manifestValidator } from "./schema.js";
import { SUPPORTED_FORMAT_MAJOR, type Manifest } from "./types.js";

/**
 * Parses and checks the text of `manifest.json`.
 * Throws MANIFEST_INVALID or FORMAT_UNSUPPORTED. Never touches the file system.
 */
export function parseManifest(bytes: Uint8Array): Manifest {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid("manifest.json 不是有效的 UTF-8 文本，无法读取。");
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid("manifest.json 不是合法的 JSON，请检查逗号、引号和括号是否写对。");
  }
  return checkManifest(value);
}

export function checkManifest(value: unknown): Manifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("manifest.json 的内容必须是一个 JSON 对象（以 { 开头）。");
  }
  assertFormatSupported((value as Record<string, unknown>).formatVersion);

  const validate = manifestValidator();
  if (validate(value)) {
    return value as Manifest;
  }
  const first = validate.errors?.[0];
  if (first === undefined) {
    throw invalid("manifest.json 的内容不符合包格式。");
  }
  throw toPlumsError(first);
}

function assertFormatSupported(formatVersion: unknown): void {
  if (typeof formatVersion !== "string" || !new RegExp(FORMAT_VERSION_PATTERN).test(formatVersion)) {
    return;
  }
  const major = Number(formatVersion.split(".")[0]);
  if (major > SUPPORTED_FORMAT_MAJOR) {
    throw new PlumsError({
      code: FORMAT_UNSUPPORTED,
      message: `这个包使用的格式版本是 ${formatVersion}，当前只支持 ${SUPPORTED_FORMAT_MAJOR}.x。请升级 Plums 后再导入。`,
      path: "/formatVersion",
    });
  }
}

function invalid(message: string, path?: string): PlumsError {
  return new PlumsError({ code: MANIFEST_INVALID, message, ...(path === undefined ? {} : { path }) });
}

function toPlumsError(error: ErrorObject): PlumsError {
  const params = error.params as Record<string, unknown>;
  let path = error.instancePath;
  if (error.keyword === "required") {
    path = `${path}/${escapePointer(String(params.missingProperty))}`;
  }
  const where = describe(path);
  const message = explain(error, path, where, params);
  return invalid(message, path === "" ? undefined : path);
}

function explain(
  error: ErrorObject,
  path: string,
  where: string,
  params: Record<string, unknown>,
): string {
  const field = lastSegment(path);
  switch (error.keyword) {
    case "required":
      return `缺少必填项 ${where}。`;
    case "enum": {
      const allowed = (params.allowedValues as unknown[]).map((v) => String(v)).join("、");
      return `${where} 的值不对，只能是 ${allowed} 之一。`;
    }
    case "const":
      return `${where} 的值必须是 ${JSON.stringify(params.allowedValue)}。`;
    case "minLength":
      return `${where} 不能为空。`;
    case "maxLength":
      return `${where} 太长了，最多 ${String(params.limit)} 个字符。`;
    case "pattern":
    case "format":
      return `${where} 的写法不对。${hint(field)}`;
    case "type":
      return `${where} 的类型不对，应该是${typeName(String(params.type))}。`;
    default:
      return `${where} 不符合包格式。`;
  }
}

function hint(field: string): string {
  switch (field) {
    case "version":
      return "版本号需要是 主版本.次版本.修订号，例如 1.2.3。";
    case "formatVersion":
      return "格式版本需要写成 主版本.次版本，例如 1.0。";
    case "id":
      return "id 只能用小写字母、数字，以及单个的 . _ - 分隔，例如 my-pack。";
    case "range":
      return "依赖版本需要是版本范围，例如 ^1.2.0 或 >=1.0.0 <2.0.0。";
    default:
      return "";
  }
}

function typeName(type: string): string {
  switch (type) {
    case "string":
      return "文字";
    case "number":
    case "integer":
      return "数字";
    case "boolean":
      return "是/否（true 或 false）";
    case "array":
      return "列表（用 [ ] 括起来）";
    case "object":
      return "对象（用 { } 括起来）";
    default:
      return type;
  }
}

/** `/permissions/0/level` becomes 「permissions」第 1 项的「level」. */
function describe(path: string): string {
  if (path === "") {
    return "manifest.json";
  }
  const segments = path.split("/").slice(1).map(unescapePointer);
  let out = "";
  segments.forEach((segment, index) => {
    if (/^\d+$/.test(segment)) {
      out += `第 ${Number(segment) + 1} 项`;
    } else {
      out += `${index > 0 ? "的" : ""}「${segment}」`;
    }
  });
  return out;
}

function lastSegment(path: string): string {
  const last = path.slice(path.lastIndexOf("/") + 1);
  return unescapePointer(last);
}

export function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapePointer(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}
