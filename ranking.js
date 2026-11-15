// 日替わりランキング(Firebase Auth の Google ログイン + Firestore)。
// ゲーム本体から動的 import されるので、オフラインや未設定でもゲームは動く。
import { firebaseConfig } from './firebase-config.js';

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

export async function onAuth(cb) {
  const m = await load();
  m.A.onAuthStateChanged(m.auth, cb);
}
export async function signIn(beforeRedirect) {
  const m = await load();
  const provider = new m.A.GoogleAuthProvider();
  try {
    await m.A.signInWithPopup(m.auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      beforeRedirect?.(); // ページが遷移するので、中断される投稿を保存しておく
      await m.A.signInWithRedirect(m.auth, provider);
    } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') throw e;
  }
}
export async function signOut() { const m = await load(); await m.A.signOut(m.auth); }

// 1日1人1件。その日の自己ベストより高いときだけ更新する。
export async function submitScore(dateKey, e) {
  const m = await load();
  const u = m.auth.currentUser;
  if (!u) return { status: 'signin' };
  const ref = m.F.doc(m.db, 'daily', dateKey, 'scores', u.uid);
  const snap = await m.F.getDoc(ref);
  if (snap.exists() && snap.data().score >= e.score) return { status: 'kept', best: snap.data().score };
  await m.F.setDoc(ref, {
    uid: u.uid, name: (u.displayName || 'Player').slice(0, 24),
    score: e.score, time: e.time, moves: e.moves, at: m.F.serverTimestamp(),
  });
  return { status: 'saved', best: e.score };
}
export async function topScores(dateKey, n = 20) {
  const m = await load();
  const q = m.F.query(m.F.collection(m.db, 'daily', dateKey, 'scores'), m.F.orderBy('score', 'desc'), m.F.limit(n));
  return (await m.F.getDocs(q)).docs.map((d) => d.data());
}
export async function rankOf(dateKey, score) {
  const m = await load();
  const q = m.F.query(m.F.collection(m.db, 'daily', dateKey, 'scores'), m.F.where('score', '>', score));
  return (await m.F.getCountFromServer(q)).data().count + 1;
}
