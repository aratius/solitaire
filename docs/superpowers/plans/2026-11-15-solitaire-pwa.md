# Solitaire PWA Implementation Plan

**Goal:** Klondike(1枚めくり)のPWAをローカル完結で作る。
**Architecture:** logic.js(純粋関数・状態) / app.js(DOM・入力・アニメ・保存) / sw.js。ビルド無し。
**Tech Stack:** HTML/CSS/ES modules, localStorage, Service Worker, Node(テスト)
**Spec:** docs/superpowers/specs/2026-11-15-solitaire-pwa-design.md

## Global Constraints
- 1枚めくり、山札無限周回 / スコア = max(0, 10000 − 秒×10 − 手数×20)
- 自動仕上げは手数に含めない / 外部依存なし

## Review Focus
- 山札を一周しても置ける札が無い盤面を「詰み」と判定、置ける札があれば詰みにしない
- 勝ち済み盤面を詰み扱いしない
- 同じ日付シードは同じ配置
- 保存データ破損時は新規ゲームで起動
- 空の山札/捨て札でのめくりが落ちない

### Task 1: logic.js + tests (TDD)
Files: logic.js, tests/logic.test.mjs
Produces: newGame(seed)→state, draw(s), move(s,from,to), autoMoveTarget(s,sel), isWon(s), isStuck(s), calcScore(sec,moves), cloneState
- [ ] テストを書き失敗確認 → 実装 → `node --test` で通す

### Task 2: UI (index.html, style.css, app.js)
カードDOM+transition、ドラッグ/タップ、配札/反転/勝利演出、詰みダイアログ、統計・途中保存、効果音/振動
- [ ] 構文チェック + Playwrightでスモーク（配札、タップ移動、undo、保存復元）

### Task 3: PWA (manifest.webmanifest, sw.js, icons)
- [ ] PILでアイコン生成、SWでオフラインキャッシュ、Playwrightでmanifest/SW登録確認
