# 夜勤手当計算アプリ UI 刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `index.html` と `style.css` を全面刷新し、Soft Care 美的方向性の L3 Dashboard + R3 Table-First レイアウトに変更する。`app.js` は 1 行も変更しない。

**Architecture:** 静的 3 ファイル構成（`index.html` / `app.js` / `style.css`）を維持。DOM ID と `renderSummary` 出力 HTML の構造は保つ。Google Fonts (CDN) から 4 書体を読み込み、CSS のみでモーションを実現。

**Tech Stack:** HTML5 / CSS3（カスタムプロパティ、Grid、Flexbox、`@keyframes`、`<details>/<summary>`）/ Google Fonts。ビルドツール・JS ライブラリは追加しない。

**検証について:** 一般的な TDD ループ（ユニットテスト）は存在しない。代替として以下を回帰テストとして使う:
1. **機能テスト**: `app.js` 内の `runTests()` を画面の「テストを実行」ボタンから実行し、T1〜T10 が全て PASS することを確認。
2. **ビジュアル検証**: ブラウザで `index.html` を直接開き (`file://`)、目視確認。
3. **実 CSV**: 既存の訪問介護シフト CSV（Shift-JIS）を読み込ませ、ダウンロードしたファイルの中身が従来と一致することを確認。

**参照スペック:** `docs/superpowers/specs/2026-04-16-night-shift-app-redesign-design.md`

---

## File Structure

| ファイル | 扱い | 責務 |
|---|---|---|
| `index.html` | 全面書き換え | セマンティック HTML、DOM 契約、`app.js` と Google Fonts のリンク |
| `style.css` | 全面書き換え | レイアウト / タイポ / カラー / モーション / レスポンシブ |
| `app.js` | **変更なし** | 計算ロジック / CSV I/O / DOM 操作 / 組み込みテスト |
| `netlify.toml` | 変更なし | デプロイ設定 |

**新規ファイルなし。** 1 ファイル 1 責務の原則は、現状の 3 ファイル構成が自然に満たしている（ロジック / 構造 / 表現）。

---

## 維持すべき DOM 契約（全タスクで遵守）

**ID:** `fileInput` / `prevFileInput` / `fileInfo` / `prevFileInfo` / `configSection` / `yearInput` / `monthInput` / `ymSource` / `runBtn` / `resultSection` / `summary` / `downloadSummaryBtn` / `downloadDetailBtn` / `testBtn` / `testResults`

**`renderSummary()` が注入するクラス:** `.summary-box` / `.error` / `.muted` / `<table>` / `<thead>` / `<tbody>` / `<td class="num">` / `<h3>` / `<ul>`

**テスト結果クラス:** `.test-table tr.pass td` / `.test-table tr.fail td`

**`hidden` 属性:** `#configSection[hidden]` と `#resultSection[hidden]` のトグルは `app.js` 制御。CSS 側で `[hidden] { display: none !important; }` を明示。

---

### Task 1: 新しい index.html の骨組みを書く

**Files:**
- Modify: `index.html`（全面書き換え）

`app.js` が参照する全 ID を保ったまま、L3 Dashboard 構造に組み替える。

- [ ] **Step 1: 既存 `index.html` を保存せず新しい内容で上書き**

以下を `index.html` に書く:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>夜勤手当計算アプリ</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,400&family=JetBrains+Mono:wght@400;600&family=Shippori+Mincho:wght@700;900&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<header class="site-header">
  <div class="header-inner">
    <div class="brand">
      <h1 class="brand-title">夜勤手当</h1>
      <p class="brand-sub"><em>Night-shift allowance</em></p>
    </div>
    <p class="privacy">🔒 ファイルはブラウザ内でのみ処理され、外部サーバーには送信されません</p>
  </div>
  <div class="header-rule"></div>
</header>

<main class="dashboard">

  <aside class="input-panel">

    <section class="step-card" id="step1">
      <span class="step-indicator"></span>
      <header class="step-head">
        <span class="step-num">01</span>
        <h2 class="step-title">CSVを選ぶ</h2>
      </header>
      <div class="form-row">
        <label for="fileInput">当月CSV<span class="req">必須</span></label>
        <input type="file" id="fileInput" accept=".csv">
      </div>
      <div id="fileInfo" class="file-info"></div>
      <div class="form-row">
        <label for="prevFileInput">前月CSV<span class="opt">任意</span></label>
        <input type="file" id="prevFileInput" accept=".csv">
      </div>
      <div id="prevFileInfo" class="file-info"></div>
      <p class="note">前月CSVを指定すると、当月1日0〜8時の夜勤手当を前月末22〜24時分と合算し、5000円上限を月跨ぎで正しく適用します。</p>
    </section>

    <section class="step-card" id="configSection" hidden>
      <span class="step-indicator"></span>
      <header class="step-head">
        <span class="step-num">02</span>
        <h2 class="step-title">年月の確認</h2>
      </header>
      <p class="note">ファイル名から自動抽出します。誤りがあれば修正してください。</p>
      <div class="form-grid">
        <div class="form-row">
          <label for="yearInput">年</label>
          <input type="number" id="yearInput" min="2000" max="2100">
        </div>
        <div class="form-row">
          <label for="monthInput">月</label>
          <input type="number" id="monthInput" min="1" max="12">
        </div>
      </div>
      <div id="ymSource" class="ym-source"></div>
    </section>

    <section class="step-card" id="step3">
      <span class="step-indicator"></span>
      <header class="step-head">
        <span class="step-num">03</span>
        <h2 class="step-title">計算する</h2>
      </header>
      <button id="runBtn" class="btn-primary">計算実行</button>
    </section>

  </aside>

  <section class="result-panel">

    <div class="result-empty" id="resultEmpty">
      <div class="empty-mark">夜</div>
      <p class="empty-title">CSVを選択すると、<br>ここに計算結果が表示されます</p>
      <p class="empty-sub">Select a CSV to see results</p>
    </div>

    <section id="resultSection" class="result-content" hidden>
      <div id="summary"></div>
      <div class="button-row">
        <button id="downloadSummaryBtn" class="btn-primary">集計CSVをダウンロード</button>
        <button id="downloadDetailBtn" class="btn-secondary">明細CSVをダウンロード</button>
      </div>
    </section>

  </section>

</main>

<section class="drawers">

  <details class="drawer">
    <summary>
      <span class="drawer-mark"></span>
      <span class="drawer-label">計算ルール</span>
      <span class="drawer-en">CALCULATION RULES</span>
    </summary>
    <div class="drawer-body">
      <ul>
        <li>1サイクル = <strong>22:00(day D) 〜 翌日 08:00</strong> の 10 時間帯</li>
        <li>サイクル候補日: 「22時以降に終わる行の日」または「8時前に始まる行の前日」</li>
        <li>サイクル内の夜勤分数を<strong>合算</strong>してから、単位換算: <strong>ceil(合計分数 / 30) × 500円</strong>（30分未満は<strong>切り上げ</strong>: 10分→500円、40分→1000円、70分→1500円）</li>
        <li>1サイクルあたりの上限: <strong>5,000円</strong></li>
        <li>明細行への配分: 同一サイクル内の行を時系列順に並べ、累積夜勤分数ベースで割り付け（合計がサイクル手当と一致）</li>
      </ul>
      <h3>CSVフォーマット（Shift-JIS / 10列）</h3>
      <p class="note">ヘルパー名 / 日付 / 曜日 / 利用者 / 業務種別 / サービス内容 / 開始時間 / 終了時間 / 提供時間 / 備考</p>
    </div>
  </details>

  <details class="drawer">
    <summary>
      <span class="drawer-mark"></span>
      <span class="drawer-label">動作確認（組み込みテスト）</span>
      <span class="drawer-en">BUILT-IN TESTS</span>
    </summary>
    <div class="drawer-body">
      <p class="note">計算ロジックを仕様テストで検証します。</p>
      <button id="testBtn" class="btn-secondary">テストを実行</button>
      <div id="testResults"></div>
    </div>
  </details>

</section>

<footer class="site-footer">
  <p>夜勤手当計算アプリ · 2026</p>
</footer>

<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: ブラウザで `index.html` を直接開いて JS エラーが出ないことを確認**

手順: ブラウザのアドレスバーに `file:///C:/Users/tcy387/OneDrive/デスクトップ/claudecode/アプリテスト/index.html` を入力 → F12 (DevTools) → Console に赤文字のエラーがないこと。

この時点ではまだ CSS が旧仕様なので見た目は崩れているが、**JS エラーが出ないこと**だけが重要。

- [ ] **Step 3: 組み込みテストを実行して T1〜T10 が全て PASS することを確認**

手順: 「動作確認（組み込みテスト）」のドロワーを開く（まだドロワーは単なる `<details>` として機能する） → 「テストを実行」ボタンをクリック → PASS 10 / FAIL 0 が表示される。

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "index.html: L3 Dashboard 構造に書き換え（DOM契約は維持）"
```

---

### Task 2: CSS の土台を作る（リセット・フォント・トークン・タイポ基底）

**Files:**
- Modify: `style.css`（全面書き換え）

以降のタスクで全て新しい `style.css` に追記していく。このタスクでは骨格を置く。

- [ ] **Step 1: `style.css` を以下で完全に置き換える**

```css
/* =========================================================
   夜勤手当計算アプリ — Soft Care Dashboard
   ========================================================= */

:root {
  /* カラートークン */
  --bg:        #efe7da;
  --surface:   #fff8ee;
  --surface-2: #f4ebe0;
  --ink:       #3a2a1e;
  --ink-soft:  #8a6a4d;
  --accent:    #8a3b0e;
  --accent-2:  #c98762;
  --line:      #eadac5;
  --danger:    #b2453c;
  --ok:        #6a7f4a;
  --cap:       #b06016;

  /* フォントスタック（オフライン時フォールバック） */
  --font-display: 'Shippori Mincho', 'Yu Mincho', 'Hiragino Mincho ProN', serif;
  --font-serif:   'Fraunces', 'Times New Roman', Georgia, serif;
  --font-sans:    'Zen Kaku Gothic New', 'Hiragino Sans', 'Yu Gothic UI', system-ui, sans-serif;
  --font-mono:    'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace;

  /* 装飾 */
  --shadow-sm: 0 2px 6px rgba(126, 82, 44, 0.08);
  --shadow-md: 0 6px 20px rgba(126, 82, 44, 0.10);
  --shadow-lg: 0 14px 30px rgba(126, 82, 44, 0.18);
  --radius:    14px;
  --radius-lg: 20px;
}

/* リセット */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; padding: 0; }
input { font: inherit; color: inherit; }
h1, h2, h3, h4, h5, h6, p, ul, ol { margin: 0; padding: 0; }
ul { list-style-position: inside; }
[hidden] { display: none !important; }

/* ベース */
body {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.65;
  background: var(--bg);
  color: var(--ink);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ユーティリティ（renderSummary が注入するクラス用の基底） */
.note, .muted {
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.6;
}

/* reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: ブラウザでリロード、エラーがないことを確認**

手順: `Ctrl+Shift+R` でハードリロード → DevTools Console でエラーがない。ページはフォントだけ切り替わった状態で、レイアウトはまだ縦流しのプレーン状態。

- [ ] **Step 3: Google Fonts がロードされていることを確認**

手順: DevTools Network タブでリロード → `fonts.googleapis.com` からの `css2?family=...` レスポンスが 200 で、続く `fonts.gstatic.com` からの `.woff2` が 200。Font family が「Shippori Mincho」「Fraunces」「Zen Kaku Gothic New」「JetBrains Mono」で取得できている。

- [ ] **Step 4: コミット**

```bash
git add style.css
git commit -m "style.css: リセット・カラートークン・フォント土台"
```

---

### Task 3: ヘッダーのスタイル

**Files:**
- Modify: `style.css`（追記）

- [ ] **Step 1: 以下を `style.css` の末尾に追記**

```css
/* =========================================================
   Header
   ========================================================= */

.site-header {
  padding: 36px 32px 0;
}

.header-inner {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.brand-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 32px;
  letter-spacing: 0.02em;
  color: var(--ink);
  line-height: 1;
}

.brand-sub {
  margin-top: 6px;
  font-family: var(--font-serif);
  font-size: 15px;
  color: var(--ink-soft);
  letter-spacing: 0.01em;
}

.brand-sub em {
  font-style: italic;
  font-weight: 400;
}

.privacy {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--ink-soft);
  padding: 6px 12px;
  background: var(--surface);
  border-radius: 999px;
  box-shadow: var(--shadow-sm);
}

.header-rule {
  max-width: 1400px;
  margin: 20px auto 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent-2), transparent);
  opacity: 0.5;
}
```

- [ ] **Step 2: ブラウザでリロード、ヘッダーの見え方を確認**

確認ポイント:
- 「夜勤手当」が Shippori Mincho で大きく表示される
- その下に Fraunces italic の `Night-shift allowance`
- 右上に 🔒 プライバシー注記が丸いピル型で表示
- 下に薄いグラデ罫線

- [ ] **Step 3: コミット**

```bash
git add style.css
git commit -m "style.css: ヘッダーのスタイル"
```

---

### Task 4: ダッシュボードの2カラムグリッドと入力パネル

**Files:**
- Modify: `style.css`（追記）

- [ ] **Step 1: 以下を `style.css` の末尾に追記**

```css
/* =========================================================
   Dashboard Grid
   ========================================================= */

.dashboard {
  max-width: 1400px;
  margin: 28px auto 0;
  padding: 0 32px;
  display: grid;
  grid-template-columns: minmax(320px, 36fr) minmax(0, 64fr);
  gap: 20px;
  align-items: start;
}

/* =========================================================
   Input Panel (Left)
   ========================================================= */

.input-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.step-card {
  position: relative;
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 20px 22px 20px 28px;
  box-shadow: var(--shadow-md);
  overflow: hidden;
  transition: box-shadow 200ms ease-out;
}

.step-card:hover { box-shadow: var(--shadow-lg); }

.step-indicator {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  background: var(--line);
  transition: background 250ms ease-out;
}

/* ステップ完了時のインジケータ変色（CSSのみで可能な範囲） */
/* ファイル選択済み: file input に value が入っている間（CSS では取れないので、#fileInfo に内容が入っているかで近似する） */
#step1:has(#fileInfo:not(:empty)) .step-indicator { background: var(--accent); }
#configSection:not([hidden]) .step-indicator { background: var(--accent); }
#step3:has(#resultSection:not([hidden])) .step-indicator { background: var(--accent); }

/* ↑ :has() 非対応ブラウザでは単に常時 --line になるだけでレイアウトは壊れない */

.step-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}

.step-num {
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: 22px;
  color: var(--accent);
  letter-spacing: -0.02em;
  line-height: 1;
}

.step-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 17px;
  color: var(--ink);
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
}

.form-row label {
  min-width: 96px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
}

.form-row label .req,
.form-row label .opt {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  border-radius: 4px;
  vertical-align: middle;
}
.form-row label .req { background: var(--accent); color: var(--surface); }
.form-row label .opt { background: var(--surface-2); color: var(--ink-soft); }

/* ファイル入力ドロップゾーン風 */
input[type="file"] {
  flex: 1;
  padding: 10px 12px;
  border: 1.5px dashed var(--accent-2);
  border-radius: 12px;
  background: var(--surface-2);
  font-size: 12px;
  color: var(--ink-soft);
  cursor: pointer;
  transition: border-color 150ms, background 150ms;
}

input[type="file"]:hover {
  border-color: var(--accent);
  background: #f9eddb;
}

/* 数値入力（年月） */
.form-grid {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.form-grid .form-row { margin: 4px 0; flex: 1; min-width: 140px; }
.form-grid .form-row label { min-width: auto; }

input[type="number"] {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-2);
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--ink);
  max-width: 120px;
}

input[type="number"]:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--surface);
}

.ym-source {
  margin-top: 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--ink-soft);
}

/* ファイル情報エリア */
.file-info {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ink-soft);
  min-height: 0;
}
.file-info:empty { display: none; }

/* Primary ボタン（計算実行・集計CSV） */
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 11px 22px;
  background: var(--accent);
  color: var(--surface);
  font-family: var(--font-sans);
  font-weight: 700;
  font-size: 14px;
  border-radius: 999px;
  box-shadow: 0 4px 10px rgba(138, 59, 14, 0.25);
  transition: transform 150ms ease-out, box-shadow 150ms ease-out, background 150ms;
}

.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(138, 59, 14, 0.32);
  background: #9b4413;
}

.btn-primary:active {
  transform: translateY(1px);
  box-shadow: 0 2px 6px rgba(138, 59, 14, 0.25);
  transition-duration: 80ms;
}

.btn-primary:disabled {
  background: var(--surface-2);
  color: var(--ink-soft);
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

/* Secondary ボタン（明細CSV・テスト実行） */
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  background: transparent;
  color: var(--accent);
  border: 1.5px solid var(--accent);
  font-family: var(--font-sans);
  font-weight: 700;
  font-size: 14px;
  border-radius: 999px;
  transition: background 150ms, color 150ms;
}

.btn-secondary:hover {
  background: var(--accent);
  color: var(--surface);
}
```

- [ ] **Step 2: ブラウザでリロード、左パネルの見え方を確認**

確認ポイント:
- 左カラム（約 36%）に 3 枚のカードが縦積み
- 各カードに「01 · CSVを選ぶ」のように番号＋タイトル
- ファイル入力が破線ボーダーのドロップゾーン風
- 「計算実行」ボタンがテラコッタ塗りのピル型
- カードの左端 4px に薄いライン（未完了状態）

- [ ] **Step 3: ファイルを1つ選択してインジケータ変色を確認**

手順: 任意の CSV を当月CSVに選択 → `#step1` の左端縦帯が `--line` → `--accent` に変色（`:has()` 対応ブラウザのみ。Firefox 121+ / Chrome 105+ / Safari 15.4+）

- [ ] **Step 4: コミット**

```bash
git add style.css
git commit -m "style.css: ダッシュボードグリッドと左入力パネル"
```

---

### Task 5: 結果パネル（空状態・summary-box・テーブル・ダウンロード・エラー）

**Files:**
- Modify: `style.css`（追記）

- [ ] **Step 1: 以下を `style.css` の末尾に追記**

```css
/* =========================================================
   Result Panel (Right)
   ========================================================= */

.result-panel {
  position: relative;
  min-height: 400px;
}

/* 空状態: #resultSection が hidden のときだけ表示 */
.result-empty {
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 40px 24px;
  background: var(--surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  text-align: center;
  gap: 14px;
  background-image:
    repeating-linear-gradient(135deg, var(--surface-2) 0, var(--surface-2) 1px, transparent 1px, transparent 12px);
}

/* app.js は #resultSection に hidden を付け外しする。#resultSection が非表示のとき空状態を出す */
.result-panel:has(#resultSection[hidden]) .result-empty,
.result-panel:not(:has(#resultSection)) .result-empty {
  display: flex;
}

.empty-mark {
  width: 64px; height: 64px;
  border: 2px solid var(--accent);
  color: var(--accent);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display);
  font-weight: 900;
  font-size: 30px;
  border-radius: 50%;
  opacity: 0.5;
}

.empty-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 17px;
  color: var(--ink);
  line-height: 1.6;
}

.empty-sub {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--ink-soft);
  text-transform: uppercase;
}

/* 結果コンテンツ本体 */
.result-content {
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 24px 28px;
  box-shadow: var(--shadow-md);
}

/* summary-box を4アイテムKPIストリップに */
.result-content .summary-box {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 32px;
  padding: 20px 24px;
  margin: 0 0 8px;
  border-top: 2px solid var(--ink);
  border-bottom: 1px dotted var(--line);
  background: var(--surface);
  border-left: none;
  border-radius: 0;
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: 28px;
  letter-spacing: -0.02em;
  color: var(--ink);
}

.result-content .summary-box strong {
  display: block;
  margin: 0;
  font-family: var(--font-mono);
  font-weight: 400;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

/* 2番目のラベル (当月合計:) だけ色を変えて強調 */
.result-content .summary-box strong:nth-of-type(2) { color: var(--accent); }

/* 見出し h3 */
.result-content h3 {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 16px;
  color: var(--ink);
  margin: 24px 0 10px;
  padding-left: 10px;
  border-left: 4px solid var(--accent);
  line-height: 1;
}

/* テーブル */
.result-content table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(126, 82, 44, 0.06);
  margin-bottom: 12px;
  font-size: 13px;
}

.result-content thead {
  background: var(--surface-2);
}

.result-content th {
  padding: 10px 14px;
  text-align: left;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--ink-soft);
}

.result-content td {
  padding: 10px 14px;
  border-top: 1px dotted var(--line);
  color: var(--ink);
}

.result-content tr:hover td {
  background: var(--surface-2);
  transition: background 100ms;
}

.result-content td.num {
  text-align: right;
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

/* エラー */
.result-content .error,
.file-info .error {
  background: #fbf1ef;
  border-left: 4px solid var(--danger);
  color: var(--danger);
  padding: 12px 16px;
  border-radius: 10px;
  margin: 12px 0;
  font-size: 13px;
  line-height: 1.6;
}

.result-content .error ul,
.file-info .error ul {
  margin: 6px 0 0 4px;
  padding-left: 14px;
}

.result-content .error strong {
  font-weight: 700;
}

/* muted */
.result-content .muted {
  color: var(--ink-soft);
  font-size: 12px;
  margin-top: 4px;
}

/* ダウンロードボタン行 */
.button-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px dotted var(--line);
}
```

- [ ] **Step 2: ブラウザでリロード、空状態の見え方を確認**

確認ポイント:
- 右パネルに「夜」の丸囲みマーク + 「CSVを選択すると、ここに計算結果が表示されます」のメッセージ
- 淡い斜線パターン背景

- [ ] **Step 3: 実 CSV で計算を実行して結果の見え方を確認**

手順: 当月CSV を選択 → 年月確認 → 「計算実行」をクリック → 右パネルが結果に切り替わる。

確認ポイント:
- `.summary-box` が 4 KPI ストリップとして表示（対象年月 / 当月合計 / サイクル数 / 従業員数）
- `<h3>従業員別合計</h3>` がセクションヘッダとして表示、左に `--accent` 縦帯
- テーブルが角丸、数値セル右寄せ Mono 色
- 行ホバーで背景変化
- ダウンロードボタン 2 つ（primary 塗り + secondary 枠線）

- [ ] **Step 4: 組み込みテストで回帰なしを確認**

手順: 「動作確認」ドロワーを開く → 「テストを実行」→ T1〜T10 全て PASS。

- [ ] **Step 5: コミット**

```bash
git add style.css
git commit -m "style.css: 結果パネル（空状態・KPIストリップ・テーブル・エラー）"
```

---

### Task 6: ドロワー（計算ルール・テスト）とテスト結果テーブル

**Files:**
- Modify: `style.css`（追記）

- [ ] **Step 1: 以下を `style.css` の末尾に追記**

```css
/* =========================================================
   Drawers (details/summary)
   ========================================================= */

.drawers {
  max-width: 1400px;
  margin: 32px auto;
  padding: 0 32px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drawer {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.drawer summary {
  list-style: none;
  cursor: pointer;
  padding: 16px 22px;
  display: flex;
  align-items: center;
  gap: 14px;
  transition: background 150ms;
}

.drawer summary::-webkit-details-marker { display: none; }

.drawer summary:hover { background: var(--surface-2); }

.drawer-mark {
  width: 10px; height: 10px;
  border-right: 2px solid var(--accent);
  border-bottom: 2px solid var(--accent);
  transform: rotate(-45deg);
  transition: transform 180ms ease-out;
  margin-left: 4px;
}

.drawer[open] .drawer-mark {
  transform: rotate(45deg);
}

.drawer-label {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 15px;
  color: var(--ink);
  flex: 1;
}

.drawer-en {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--ink-soft);
}

/* body を grid-rows トランジションで展開 */
.drawer-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 250ms ease-out;
}

.drawer[open] .drawer-body {
  grid-template-rows: 1fr;
}

.drawer-body > * {
  min-height: 0;
}

.drawer-body {
  padding: 0 22px;
}

.drawer[open] .drawer-body {
  padding: 4px 22px 18px;
}

.drawer-body ul {
  padding-left: 22px;
  font-size: 13px;
  line-height: 1.8;
}

.drawer-body ul li strong {
  color: var(--accent);
}

.drawer-body h3 {
  margin: 14px 0 6px;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink);
}

.drawer-body .note {
  margin-top: 4px;
  font-size: 12px;
}

/* テスト結果テーブル */
#testResults {
  margin-top: 14px;
}

#testResults table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: var(--font-mono);
  background: var(--surface);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(126, 82, 44, 0.06);
}

#testResults th, #testResults td {
  padding: 8px 12px;
  border-top: 1px dotted var(--line);
  text-align: left;
}

#testResults thead th {
  background: var(--surface-2);
  border-top: none;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--ink-soft);
}

.test-table tr.pass td { background: #f1f5ea; }
.test-table tr.pass td:last-child { color: var(--ok); font-weight: 700; }

.test-table tr.fail td { background: #fbf1ef; color: var(--danger); }
.test-table tr.fail td:last-child { font-weight: 700; }
```

- [ ] **Step 2: ブラウザでリロード、ドロワーの見え方を確認**

確認ポイント:
- ページ下に 2 つのドロワー「計算ルール」「動作確認（組み込みテスト）」
- ▸ マーカー（CSS で書いた菱形）
- クリックで滑らかに開閉
- 開いたとき ▸ が 90° 回転

- [ ] **Step 3: テスト実行してテーブルの見え方を確認**

手順: 「動作確認」ドロワーを開く → 「テストを実行」をクリック。

確認ポイント:
- 10 行の結果が表示
- PASS 行は薄緑背景、結果セルが `--ok` 色
- FAIL 行は薄赤背景、結果セルが `--danger` 色
- 全行が PASS であること（T1〜T10）

- [ ] **Step 4: コミット**

```bash
git add style.css
git commit -m "style.css: ドロワーとテスト結果テーブル"
```

---

### Task 7: モーション（ページロードスタガー、結果出現、prefers-reduced-motion）

**Files:**
- Modify: `style.css`（追記）

- [ ] **Step 1: 以下を `style.css` の末尾に追記**

```css
/* =========================================================
   Motion
   ========================================================= */

@keyframes fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.site-header   { animation: fade-up 300ms ease-out 0ms both; }
.input-panel   { animation: fade-up 300ms ease-out 80ms both; }
.result-panel  { animation: fade-up 300ms ease-out 160ms both; }
.drawers       { animation: fade-up 300ms ease-out 240ms both; }

/* 結果要素のスタガー出現（#summary の子要素） */
@keyframes summary-enter {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

#summary > .summary-box { animation: summary-enter 350ms ease-out 0ms both; }
#summary > h3           { animation: summary-enter 350ms ease-out 120ms both; }
#summary > table        { animation: summary-enter 350ms ease-out 240ms both; }
#summary > h3 + table,
#summary > h3 + h3,
#summary > p.muted      { animation: summary-enter 350ms ease-out 360ms both; }

/* ボタン行も遅らせて出す */
#resultSection .button-row {
  animation: summary-enter 350ms ease-out 480ms both;
}

/* footer */
.site-footer {
  max-width: 1400px;
  margin: 24px auto;
  padding: 20px 32px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--ink-soft);
  text-align: center;
  text-transform: uppercase;
}
```

- [ ] **Step 2: ブラウザでハードリロード、ロードアニメーションを確認**

確認ポイント:
- ヘッダー → 左パネル → 右パネル → ドロワー の順にわずかに遅れて上から滑り込む

- [ ] **Step 3: 再計算して結果の段階的登場を確認**

手順: 既にアップ済みなら「計算実行」再クリック → `#summary` の中身が段階的にフェードイン

- [ ] **Step 4: reduce motion を OS でオンにして動作確認**

手順（Windows 11）: 設定 → アクセシビリティ → 視覚効果 → 「アニメーション効果」を OFF → ブラウザをリロード → アニメーションが無効化されている（即座に最終状態）

確認後 OS 設定を元に戻してよい。

- [ ] **Step 5: コミット**

```bash
git add style.css
git commit -m "style.css: モーション（ページロード・結果出現・reduce-motion対応）"
```

---

### Task 8: レスポンシブ対応（≤959px / ≤600px）

**Files:**
- Modify: `style.css`（追記）

- [ ] **Step 1: 以下を `style.css` の末尾に追記**

```css
/* =========================================================
   Responsive
   ========================================================= */

@media (max-width: 959px) {
  .dashboard {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .header-inner {
    flex-direction: column;
    align-items: flex-start;
  }

  .privacy {
    align-self: stretch;
    text-align: center;
  }

  .result-panel { min-height: auto; }
  .result-empty { min-height: 260px; padding: 24px 16px; }

  .result-content .summary-box {
    font-size: 22px;
    gap: 8px 20px;
    padding: 16px 18px;
  }

  .drawers { margin: 24px auto; padding: 0 20px; }
  .site-header { padding: 24px 20px 0; }
  .dashboard { padding: 0 20px; }
}

@media (max-width: 600px) {
  /* フォームは縦並び */
  .form-row {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .form-row label { min-width: auto; font-size: 12px; }

  .form-grid { flex-direction: column; }
  .form-grid .form-row { min-width: 0; }

  input[type="number"] { max-width: none; width: 100%; }

  .step-card { padding: 16px 18px 16px 22px; }
  .step-num { font-size: 18px; }
  .step-title { font-size: 15px; }

  /* 結果テーブルは親を横スクロール可能に */
  .result-content { padding: 18px 16px; overflow-x: auto; }
  .result-content table { min-width: 480px; }

  .result-content .summary-box { font-size: 20px; }
  .result-content h3 { font-size: 14px; }

  .button-row { flex-direction: column; }
  .button-row .btn-primary,
  .button-row .btn-secondary { width: 100%; }

  .brand-title { font-size: 26px; }
  .brand-sub { font-size: 13px; }

  .drawer summary { padding: 14px 18px; gap: 10px; }
  .drawer-label { font-size: 14px; }
  .drawer-en { display: none; }
}
```

- [ ] **Step 2: ブラウザ DevTools でレスポンシブ検証**

手順: DevTools → デバイスツールバー → 幅を調整:

- **1200px**: 2 カラム、全要素正常
- **900px (959px以下)**: 1 カラムに崩れる、ヘッダーも縦積み、summary-box が 22px
- **420px (600px以下)**: フォームラベルが上、入力が下に縦積み。テーブルが横スクロール。ドロワーの英文ラベルが非表示。ボタンが横幅いっぱい

- [ ] **Step 3: 幅を戻して組み込みテスト再実行で回帰ゼロ確認**

手順: 通常幅に戻す → ドロワーを開く → 「テストを実行」→ T1〜T10 全て PASS。

- [ ] **Step 4: コミット**

```bash
git add style.css
git commit -m "style.css: レスポンシブ対応（≤959 縦積み / ≤600 スマホ調整）"
```

---

### Task 9: 最終検証スイープ

**Files:** なし（確認のみ）

仕様書 §9 の全項目を通しで検証する。

- [ ] **Step 1: 機能回帰ゼロの確認**

手順:
1. ブラウザで `index.html` を開き、実 CSV（Shift-JIS）を当月CSVに選択 → ファイル名と行数が `#fileInfo` に表示される
2. 前月CSV（任意）も選択 → `#prevFileInfo` に表示される
3. `#yearInput` / `#monthInput` に自動抽出された年月が入る
4. 「計算実行」→ `#summary` に結果が出る
5. 「集計CSVをダウンロード」→ ファイル保存ダイアログ → 保存された CSV の先頭が UTF-8 BOM (`EF BB BF`) で、「ヘルパー名,サイクル数,夜勤手当」のヘッダから始まる
6. 「明細CSVをダウンロード」→ 保存 → 元 CSV の全列 + 「夜勤手当」列が追加されている
7. 不正な CSV（空ファイルなど）を選択 → `#fileInfo` か `#summary` にエラーが `.error` スタイルで表示される

- [ ] **Step 2: ビジュアル忠実度**

ブレストで選定した R3 Table-First に沿っていること:
- 合計ストリップが上にあり、下に従業員テーブル・サイクル明細テーブル
- 4 書体が確認できる（DevTools の Computed パネルで `font-family` を検査、`Shippori Mincho` / `Fraunces` / `Zen Kaku Gothic New` / `JetBrains Mono` が実際に当たっている）
- カラートークンが §4.3 と一致（例: primary ボタンの背景が `rgb(138, 59, 14)` = `#8a3b0e`）
- 左パネルのステップ完了インジケータが CSV 選択後に `--accent` に変色（`:has()` 対応ブラウザで）

- [ ] **Step 3: レスポンシブ**

- 1200px: 2 カラム
- 900px: 1 カラム
- 420px: スマホ調整

- [ ] **Step 4: モーション**

- ページロード時にヘッダー → 左 → 右 → ドロワーが段階的に登場
- OS の reduce motion オンでアニメ無効化

- [ ] **Step 5: オフライン挙動（Google Fonts 失敗時）**

手順: DevTools Network タブで「Offline」に設定 → ハードリロード → ページが崩壊せず、フォールバックフォント（`Yu Mincho` / `Times New Roman` / `Hiragino Sans` / `Consolas` など OS にあるもの）でレイアウトが維持されている。

- [ ] **Step 6: 組み込みテスト最終 PASS 確認**

手順: 「動作確認」ドロワー → 「テストを実行」→ T1〜T10 全て PASS。

- [ ] **Step 7: 完了コミット**（もしリファクタリングがあった場合のみ）

```bash
git status  # 差分がなければこのステップは不要
```

**全ステップ PASS で完了。** `main` へ push すると Netlify が自動デプロイする。
