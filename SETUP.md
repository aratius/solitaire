# ランキング公開の手順（スマホでできます）

コードはすべて入っています。あなたの操作が必要なのは下の3か所だけです。

## 1. GitHub にリポジトリを作る
GitHubアプリ → ＋ → New repository → 名前 `solitaire`、**Public** で作成（Pagesの無料枠は公開リポジトリが必要）。
→ Claudeに「作った」と伝える（Claudeがpushします）。
→ push後: リポジトリの Settings → Pages → Source を **GitHub Actions** にする。
公開URLは `https://aratius.github.io/solitaire/` になります。

## 2. Firebase を作る (https://console.firebase.google.com)
1. プロジェクトを追加（Analyticsは不要）
2. Build → Authentication → 始める → ログイン方法 → **Google** を有効化
3. Build → Firestore Database → データベースを作成（本番モード、ロケーション asia-northeast1）
4. Firestore の「ルール」タブに `firestore.rules` の中身を貼って **公開**
5. Authentication → 設定 → 承認済みドメイン → `aratius.github.io` を追加
6. プロジェクトの設定 → マイアプリ → ウェブ (</>) を登録 → 表示される `firebaseConfig` をClaudeに貼る
   （公開されても問題ない識別子です。Claudeが `firebase-config.js` に入れてpushします）

## 3. 動作確認
公開URLを開く → メニューに「Daily Ranking」と「Sign in with Google」が出る → デイリーモードでクリア → 結果画面で投稿。
