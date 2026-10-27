// The --since argument of the summary and advise CLIs: an ISO date, or a
// span such as 30d or 6w counted back from now.
export function parseSince(value, now = new Date()) {
  if (!value) return null;
  const span = /^(\d+)([dw])$/.exec(value);
  if (span) {
    const days = Number(span[1]) * (span[2] === 'w' ? 7 : 1);
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`--since takes an ISO date or a span such as 30d or 6w, not ${value}`);
  return new Date(t).toISOString();
}
