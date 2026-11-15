// Firebaseコンソールの「プロジェクトの設定 > マイアプリ(Web)」の firebaseConfig をここに貼る。
// これは公開されても問題ない識別子です(守るのは Firestore のルールとログイン)。
// null のままだとランキング機能は非表示になり、ゲームはローカル保存だけで動きます。
export const firebaseConfig = null;
/* 例:
export const firebaseConfig = {
  apiKey: '...', authDomain: '<project>.firebaseapp.com', projectId: '<project>',
  storageBucket: '<project>.firebasestorage.app', messagingSenderId: '...', appId: '...',
};
*/
