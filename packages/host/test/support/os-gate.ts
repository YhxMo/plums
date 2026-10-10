import { controlledSystemProgramSupported as supportsSystemProgram } from "../../src/os-gate.mjs";
export { macosMajor } from "../../src/os-gate.mjs";
export const controlledSystemProgramSupported = supportsSystemProgram();
export const projectNativeAcceptance = controlledSystemProgramSupported;
