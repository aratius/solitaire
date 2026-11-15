# ソリティア (PWA)

クロンダイク・1枚めくり。山札は何周でもめくれます。山札まで見て動かせる手が無くなったら即「詰み」。

## 動かす
    cd solitaire && python3 -m http.server 8000   # または npx serve
    # → http://localhost:8000
スマホにインストールするにはHTTPSが必要です（GitHub Pagesなどに置く）。

## テスト
    node --test tests/logic.test.mjs tests/solver.test.mjs

## 構成
- logic.js … ルール・詰み判定・スコア（DOM非依存）
- solver.js / solver-worker.js … Give Up時の自動解答（Web Worker。最短保証なし・時間制限つき探索）
- app.js … 描画・操作・アニメーション・保存
- sw.js / manifest.webmanifest / icons … PWA
- 保存: localStorage `solitaire.v1`（記録・設定・途中の盤面）
- スコア = max(0, 10000 − 秒×10 − 手数×20)
- デイリー: 日付シードで全員同じ配置（将来のサーバー投稿用）

## ランキング
- ranking.js / periods.js / firebase-config.js / firestore.rules … ランキング(Firebase 匿名認証 + Firestore)。`firebase-config.js` が null の間は非表示。
- デイリーモードでその日の自己ベストが出たときだけ「投稿しますか?」と聞く。投稿のたびにニックネームを付ける(前回の名前が入る)。
- 日・週(月曜始まり)・月・全期間のランキングを見られる。時刻は日本時間。
- 1人1日1件。同じ日はスコアが上がったときだけ更新される。
- 公開と設定の手順は SETUP.md(Googleログインは使わなくなった。Authentication は「匿名」を有効にする)。
