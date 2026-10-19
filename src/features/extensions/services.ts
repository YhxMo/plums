const entries = (declared: Record<string, number> = {}, suffix = "") =>
  Object.entries(declared).map(
    ([name, version]) => `${name}@${version}${suffix}`,
  );

/** Lists declared services as `name@version`, optional ones marked; 无 when none. */
export const serviceList = (
  declared?: Record<string, number>,
  optional?: Record<string, number>,
) =>
  [...entries(declared), ...entries(optional, "（可选）")].join("、") || "无";
