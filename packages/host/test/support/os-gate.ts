import { macosMajor } from "../../../../scripts/macos-version.mjs";
export { macosMajor };
// macos-15 profile shows preview arm64e ABI rejection of the re-signed system copy.
// 27 is the existing accepted target; intervening major versions are unverified.
export const controlledSystemProgramSupported =
  process.platform === "darwin" &&
  process.arch === "arm64" &&
  macosMajor()! >= 27;
export const projectNativeAcceptance = controlledSystemProgramSupported;
