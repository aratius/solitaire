// Rankings (Firebase anonymous auth + Firestore). Loaded lazily by the game, so the game still works offline or unconfigured.
// One document per player per day: scores/{uid}_{day}. Week/month are stored on the document so each view is a plain query.
import { firebaseConfig } from './firebase-config.js';
import { monthKey, weekStart, rankRows, rankIn } from './periods.js';

const V = '10.14.1';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;
export const enabled = !!(firebaseConfig && firebaseConfig.apiKey);

let mod = null;
async function load() {
  if (!enabled) throw new Error('ranking disabled');
  if (mod) return mod;
  const [app, auth, fs] = await Promise.all([
    import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore.js`),
  ]);
  const a = app.initializeApp(firebaseConfig);
  mod = { auth: auth.getAuth(a), db: fs.getFirestore(a), A: auth, F: fs };
  return mod;
}

// Anonymous sign-in happens silently the first time someone posts. There is no login screen.
async function ensureUser(m) {
  await m.auth.authStateReady();
  return m.auth.currentUser || (await m.A.signInAnonymously(m.auth)).user;
}
export async function me() {
  const m = await load();
  await m.auth.authStateReady();
  return m.auth.currentUser ? m.auth.currentUser.uid : null;
}

// Posts today's best. Only replaces an earlier post for the same day when the new score is higher.
export async function submitScore(day, name, e) {
  const m = await load();
  const u = await ensureUser(m);
  const ref = m.F.doc(m.db, 'scores', `${u.uid}_${day}`);
  const snap = await m.F.getDoc(ref);
  if (snap.exists() && snap.data().score >= e.score) return { status: 'kept', best: snap.data().score };
  await m.F.setDoc(ref, {
    uid: u.uid, name, score: e.score, time: e.time, moves: e.moves,
    day, week: weekStart(day), month: monthKey(day), at: m.F.serverTimestamp(),
  });
  return { status: 'saved', best: e.score };
}

// kind: 'day' | 'week' | 'month' | 'all'. `day` is today's JST date key; week and month are the ones that contain it.
async function fetchRows(kind, day) {
  const m = await load();
  const col = m.F.collection(m.db, 'scores');
  const q = kind === 'day' ? m.F.query(col, m.F.where('day', '==', day), m.F.limit(300))
    : kind === 'week' ? m.F.query(col, m.F.where('week', '==', weekStart(day)), m.F.limit(500))
    : kind === 'month' ? m.F.query(col, m.F.where('month', '==', monthKey(day)), m.F.limit(500))
    : m.F.query(col, m.F.orderBy('score', 'desc'), m.F.limit(200));
  return (await m.F.getDocs(q)).docs.map((d) => d.data());
}
export async function topScores(kind, day, n = 30) {
  return rankRows(await fetchRows(kind, day), n);
}
export async function rankOf(kind, day, score, uid) {
  return rankIn(await fetchRows(kind, day), score, uid);
}
