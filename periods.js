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

// Ranking categories. Each document holds the player's best score (highest), fastest time and fewest moves for the day.
export const CATS = ['score', 'speed', 'moves'];
const FIELD = { score: 'score', speed: 'time', moves: 'moves' };
export const catField = (cat) => FIELD[cat] || 'score';
// <0 when row a ranks above row b in this category (ties fall back to the other measures).
function better(cat) {
  if (cat === 'speed') return (a, b) => a.time - b.time || b.score - a.score || a.moves - b.moves;
  if (cat === 'moves') return (a, b) => a.moves - b.moves || a.time - b.time || b.score - a.score;
  return (a, b) => b.score - a.score || a.time - b.time || a.moves - b.moves;
}

// One row per player (their best entry in the category), best first.
export function rankRows(rows, n = Infinity, cat = 'score') {
  const cmp = better(cat);
  const best = new Map();
  for (const r of rows) {
    const cur = best.get(r.uid);
    if (!cur || cmp(r, cur) < 0) best.set(r.uid, r);
  }
  return [...best.values()].sort(cmp).slice(0, n);
}

// Rank (1-based) that `value` would hold in the category among the given rows; other players only.
export function rankIn(rows, value, uid, cat = 'score') {
  const f = catField(cat);
  const ahead = (r) => (cat === 'score' ? r[f] > value : r[f] < value);
  return 1 + rankRows(rows, Infinity, cat).filter((r) => r.uid !== uid && ahead(r)).length;
}

// Merge two sets of personal bests (highest score, fastest time, fewest moves).
export function mergeBests(a, b) {
  if (!a) return { ...b };
  return { score: Math.max(a.score, b.score), time: Math.min(a.time, b.time), moves: Math.min(a.moves, b.moves) };
}
// True when `now` beats `then` in at least one category (then may be missing).
export function improved(now, then) {
  return !then || now.score > then.score || now.time < then.time || now.moves < then.moves;
}
