const pad = (n: number) => String(n).padStart(2, "0");
const dayStart = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Chat-style local time: today "14:05", then "昨天", dates and years. */
export function formatTime(at: number, now = Date.now(), short = false) {
  const d = new Date(at);
  const today = dayStart(new Date(now));
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (at >= today) return clock;
  if (at >= today - 864e5) return short ? "昨天" : `昨天 ${clock}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  if (short)
    return `${sameYear ? "" : `${d.getFullYear()}/`}${d.getMonth() + 1}/${d.getDate()}`;
  return `${sameYear ? "" : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日 ${clock}`;
}

/** Messages more than five minutes apart get a time divider between them. */
export const TIME_GAP = 5 * 60_000;
