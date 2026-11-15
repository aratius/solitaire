// Ranking helpers (pure, no DOM). All day keys are JST calendar dates: 'YYYY-MM-DD'.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthKey = (day) => day.slice(0, 7);

// Monday of the week that contains `day` (weeks run Monday to Sunday).
export function weekStart(day) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}
export function weekEnd(day) {
  const [y, m, d] = weekStart(day).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 6));
  return t.toISOString().slice(0, 10);
}

export function fmtDay(day) {
  const [, m, d] = day.split('-').map(Number);
  return `${MON[m - 1]} ${d}`;
}

export function periodLabel(kind, day) {
  if (kind === 'day') return `${fmtDay(day)} (JST)`;
  if (kind === 'week') return `${fmtDay(weekStart(day))} – ${fmtDay(weekEnd(day))}`;
  if (kind === 'month') { const [y, m] = day.split('-').map(Number); return `${FULL[m - 1]} ${y}`; }
  return 'All time';
}

// One row per player (their best entry), best first: score desc, then time asc, then moves asc.
export function rankRows(rows, n = Infinity) {
  const better = (a, b) => b.score - a.score || a.time - b.time || a.moves - b.moves; // <0: a is better
  const best = new Map();
  for (const r of rows) {
    const cur = best.get(r.uid);
    if (!cur || better(r, cur) < 0) best.set(r.uid, r);
  }
  return [...best.values()].sort(better).slice(0, n);
}

// Rank (1-based) that `score` would hold among the given rows; other players only.
export function rankIn(rows, score, uid) {
  return 1 + rankRows(rows).filter((r) => r.uid !== uid && r.score > score).length;
}
