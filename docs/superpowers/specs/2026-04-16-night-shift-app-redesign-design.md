# 夜勤手当計算アプリ UI 刷新 設計書

作成日: 2026-04-16
対象アプリ: 夜勤手当計算アプリ（`index.html` / `app.js` / `style.css`）

---

## 1. 背景と目的

現行 UI は汎用の管理ツール風（青系 / Inter 系 / 矩形カード）で、ジェネリックな印象が強い。社内の勤怠担当者（数名、ラップトップ主体）が使う業務ツールとして、より落ち着きと温かみのあるデザインに刷新し、「訪問介護」という業務領域に沿ったトーンを与える。

**スコープ:** HTML / CSS の全面刷新。計算ロジックと DOM ID への依存がある `app.js` は **1 行も触らない**。

## 2. 非機能要件・制約

- **外部送信なしの方針は維持**: 計算処理はブラウザ内完結。
- **外部依存の追加は Google Fonts のみ**: JS ライブラリ・アニメーションライブラリは追加しない（CSS のみで実現）。Google Fonts CDN は許容（採用時にユーザー承諾済み: 2026-04-16 ブレインストーミング）。
- **ビルドツールは導入しない**: 現状の静的 3 ファイル構成を維持（`index.html` / `app.js` / `style.css`）。
- **組み込みテスト互換**: `runTests()` が使う `.test-table tr.pass / tr.fail` クラス命名は維持。
- **`app.js` の DOM 依存を保つ**: 後述の ID 一覧をすべて維持。

## 3. ユーザーとデバイス

- **ユーザー**: 社内の勤怠担当者数名（固定メンバー）。
- **デバイス**: ラップトップ中心（13〜15 インチ）。たまにスマホで確認する可能性あり。
- **ブレークポイント**:
  - `≥ 960px`: メインターゲット。2 カラムダッシュボード。
  - `600–959px`: 単純な縦積みフォールバック。
  - `≤ 600px`: スマホ専用調整（フォームラベル縦並び / テーブル横スクロール）。

## 4. 美的方向性: **Soft Care**

暖色（クリーム・テラコッタ）＋明朝体。訪問介護の「人が人を支える」文脈に合う、温かく誠実で落ち着いた印象。

### 4.1 タイポグラフィ（Google Fonts）

| 用途 | フォント | ウェイト |
|---|---|---|
| 和文見出し・セクションタイトル | Shippori Mincho | 700 / 900 |
| 英数字・金額・大型数値 | Fraunces (opsz 9-144) | 600 / 700 |
| 和文本文・UI テキスト | Zen Kaku Gothic New | 400 / 500 / 700 |
| 等幅・ラベル・キッカー・数値補助 | JetBrains Mono | 400 / 600 |

フォールバック: `"Shippori Mincho", "Yu Mincho", serif` / `"Fraunces", "Times New Roman", serif` / `"Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic UI", sans-serif` / `"JetBrains Mono", ui-monospace, monospace`。オフライン時も崩壊しないこと。

### 4.2 タイポスケール

- 大型数値: Fraunces 600 / 28px / `letter-spacing: -0.02em`（`.summary-box` 内の値。960px 未満で 22px）
  - ※ `.summary-box` の HTML 構造上、`<strong>` が 4 つのラベルを担当し、その後の「値」は text node として兄弟に続く。text node を直接セレクトできないため、`.summary-box` 全体に Fraunces 28px を適用し、`<strong>` だけ小型 Mono ラベル化する方式で視覚的な大小差を作る。
- H1: Shippori Mincho 700 / 28px
- H2: Shippori Mincho 700 / 18px
- 本文: Zen Kaku Gothic New 400 / 14px / `line-height: 1.65`
- ラベル: JetBrains Mono 400 / 10px / `letter-spacing: 0.2em` / UPPERCASE

### 4.3 カラートークン（`:root` 変数）

```css
--bg:        #efe7da;  /* ベージュ地 */
--surface:   #fff8ee;  /* カード/サーフェス */
--surface-2: #f4ebe0;  /* ネスト層・フィールド背景 */
--ink:       #3a2a1e;  /* 本文 */
--ink-soft:  #8a6a4d;  /* ミュート */
--accent:    #8a3b0e;  /* テラコッタ（主要アクション・数値） */
--accent-2:  #c98762;  /* 副アクセント（ホバー・装飾） */
--line:      #eadac5;  /* 罫線 */
--danger:    #b2453c;
--ok:        #6a7f4a;
--cap:       #b06016;  /* 上限到達の注意色 */
```

テーマ: ライトのみ（ダークモードは v1 では作らない）。

## 5. レイアウト構造（L3 Dashboard）

### 5.1 ≥ 960px（メイン）

```
┌─────────────────────────────────────────────────────────┐
│ HEADER   夜勤手当 · Night-shift allowance               │
│          🔒 ファイルはブラウザ内でのみ処理されます         │
└─────────────────────────────────────────────────────────┘
┌──────────────────────┬──────────────────────────────────┐
│  INPUT PANEL (左 36%) │  RESULT PANEL (右 64%)            │
│                      │                                  │
│  01 · CSVを選ぶ       │  [計算前] 空状態プレースホルダ    │
│   - 当月CSV（必須）    │                                  │
│   - 前月CSV（任意）    │  [計算後]                         │
│                      │   合計ストリップ                   │
│  02 · 年月の確認       │   従業員別合計テーブル             │
│                      │   サイクル明細テーブル（30件）       │
│  03 · 計算する        │   [集計CSV] [明細CSV] ボタン       │
│   [計算実行]          │                                  │
└──────────────────────┴──────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ INFO DRAWER（折りたたみ） ▸ 計算ルール  ▸ 動作確認テスト  │
└─────────────────────────────────────────────────────────┘
```

- 左パネル: 3ステップを常時表示。縦積みカード、各カードは独立したサーフェス。
- 右パネル: `configSection` / `resultSection` の `hidden` 属性トグルは `app.js` が制御（維持）。未計算時は空状態、計算後に `#summary` が差し替わる。
- `計算ルール` と `テスト` はページ末尾のドロワーへ移動。`<details>/<summary>` で CSS のみアニメーション。

### 5.2 600–959px

- 2 カラムが 1 カラムに崩れる（左パネル → 右パネルの縦積み）。
- `.summary-box` 内の数値サイズ: 28px → 22px。

### 5.3 ≤ 600px（スマホ）

- フォームのラベル／入力を縦並び。
- `<table>` は親に `overflow-x: auto` を与えて横スクロール。

## 6. コンポーネント詳細

### 6.1 ヘッダー

- 左: Shippori Mincho で「夜勤手当」、下に Fraunces italic で `Night-shift allowance`。
- 右: 🔒 プライバシー注記（JetBrains Mono, tracking 0.2em, 小型）。
- 下部に極細の装飾罫線（`--accent-2` の水平グラデーション）。

### 6.2 入力カード（3枚）

- `border-radius: 20px`、`box-shadow: 0 6px 20px rgba(126,82,44,.10)`、背景 `--surface`。
- **左端 4px に縦帯**: 未完了時 `--line`、完了時（ファイル読み込み成功 / 年月確定）に `--accent` へ 250ms `ease-out` で変色。
  - 完了判定は CSS のみで可能な範囲で実現。例: `#fileInput:valid ~ .step-indicator` や `#fileInfo:not(:empty) + .step-indicator` など。不可能な場合は JS を触らず「常時 `--line`」とする（妥協可）。
- 見出し: Fraunces で `01` を大きく + Shippori Mincho で「・CSVを選ぶ」。
- ファイル入力: 破線ボーダー `1.5px dashed --accent-2` のドロップゾーン風（`<label for="fileInput">` でクリック領域化）。
- `#fileInfo` / `#prevFileInfo` はカード下部。`.error` と通常テキスト両方をスタイル対応。
- 年月入力: 数値入力 2 つを横並び。`#ymSource` は下に JetBrains Mono の注記。
- 計算ボタン: ピル型、`--accent` 塗り、クリック時に沈み込みアニメ。

### 6.3 結果エリア

**空状態（計算前）:**
- `#resultSection[hidden]` は `app.js` により制御。さらに HTML 内で空状態用の要素（`#resultEmpty` など新設）を `resultSection` の外側に置き、`#configSection` 未表示 / `#resultSection` 未表示のときだけ見えるようにする。
- `--surface-2` 地に Shippori Mincho で「CSVを選択すると、ここに計算結果が表示されます」。装飾として小さな斜線パターンまたは細線アイコン。

**計算後（`#summary` の中身、app.js が注入する HTML をスタイリング）:**

| 要素 | デザイン |
|---|---|
| `.summary-box` | 「合計ストリップ」として `display: flex; flex-wrap: wrap; gap: 10px 32px;`。上に 2px `--ink`、下に 1px dotted `--line` の区切り線。背景 `--surface`、`padding: 20px 24px`。`font-family: 'Fraunces'`, 28px で値を大きく見せ、内包する `<strong>` 4 つ（`対象年月:` / `当月合計:` / `サイクル数:` / `従業員数:`）を `display: block; font-family: 'JetBrains Mono'; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-soft); font-weight: 400` に上書きしてマイクロラベル化。各 `<strong>` の直後の text node が Fraunces 28px で続き、ラベル→値の縦ペアが 4 つ横並びに見える。`<strong>:nth-of-type(2)`（`当月合計:`）だけ `color: var(--accent)` で強調。既存の `.summary-box strong + strong { margin-left: 1rem }` は `margin-left: 0` で上書き |
| `<h3>従業員別合計</h3>` / `<h3>サイクル明細...</h3>` | Shippori Mincho 16px + 左 4px 縦帯 `--accent` |
| `<table>` | 角丸 12px、ヘッダー `--surface-2`、`<td class="num">` は JetBrains Mono + `--accent` + 右寄せ。行区切り `1px dotted --line`。ホバー時 `--surface-2` へ 100ms 遷移 |
| `.muted` | `--ink-soft` |

**ダウンロードボタン行 (`.button-row`):**
- `#downloadSummaryBtn` (primary): `--accent` 塗り、白文字、ピル型。
- `#downloadDetailBtn` (secondary): 枠線のみ、`--accent` 文字色。

### 6.4 Info Drawer（ページ末尾）

- 2 つの `<details>/<summary>`: 「計算ルール」「動作確認（組み込みテスト）」。
- デフォルト閉じ。`summary` 左の ▸ マーカーを自前で用意し、`[open]` 時に 90° 回転（180ms）。
- コンテンツは `grid-template-rows: 0fr → 1fr` のトランジションで 250ms スライドイン。
- 内部:
  - 「計算ルール」: 既存の `<ul>` + CSV フォーマット説明をそのまま収容。
  - 「動作確認テスト」: `#testBtn` + `#testResults`。テスト結果テーブル（`.test-table`）の PASS / FAIL 行スタイリングを現行互換で維持（`tr.pass td` / `tr.fail td`）。

### 6.5 エラー (`.error`)

- 左 4px 帯 `--danger`、背景 `#fbf1ef`、本文 `--danger`、`border-radius: 10px`、`padding: 12px 16px`。

## 7. モーション

**CSS のみ。JS 追加なし。**

- **ページロード**: ヘッダー → 左パネル → 右パネル の順に `fade-up`（`translateY(8px → 0)` + `opacity 0 → 1`）、各 300ms、80ms スタガー、`ease-out`。
- **ステップ完了インジケータ**: 縦帯の色変化 250ms `ease-out`。
- **計算実行ボタン**:
  - hover: `translateY(-1px)` + `box-shadow` 濃化、150ms。
  - active: `translateY(1px)`、80ms。
  - `:disabled`: `--surface-2` 塗り、`cursor: not-allowed`。
- **結果要素の出現**: `#summary` の子要素に `@keyframes summary-enter`（`fade + translateY(6→0)` 350ms）を `animation-delay` 付きで適用。`.summary-box` 0ms / `h3` 120ms / `table` 240ms / `.button-row` 360ms。
- **テーブル行ホバー**: `background: --surface-2`、100ms。
- **ドロワー**: `summary` マーカーの回転、コンテンツの grid-rows トランジション。

**アクセシビリティ:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 8. 維持すべき DOM 契約

以下の ID と既存クラスは変更不可（`app.js` が参照）:

**ID:**
`fileInput` / `prevFileInput` / `fileInfo` / `prevFileInfo` / `configSection` / `yearInput` / `monthInput` / `ymSource` / `runBtn` / `resultSection` / `summary` / `downloadSummaryBtn` / `downloadDetailBtn` / `testBtn` / `testResults`

**`renderSummary()` が出力するクラス・要素（CSS で受ける）:**
`.summary-box` / `.error` / `.muted` / `table` / `thead` / `tbody` / `td.num` / `<h3>` / `<ul>`（エラー時）

**テスト表のクラス:**
`.test-table tr.pass td` / `.test-table tr.fail td`

**`hidden` 属性:** `#configSection[hidden]` と `#resultSection[hidden]` のトグルは `app.js` 制御。CSS 側は `[hidden] { display: none; }` を明示（ブラウザデフォルトだが安全のため）。

## 9. 検証と完了基準

### 9.1 機能の回帰ゼロ

1. CSV（Shift-JIS）を読ませて計算が完了する。
2. 前月 CSV 併用でも正常動作。
3. 年月の自動抽出・手動修正が動作。
4. `集計CSV` / `明細CSV` ダウンロード正常（UTF-8 BOM 付き）。
5. エラー（ファイル不正・年月不正・データなし）が `.error` スタイルで表示される。
6. 組み込みテスト `runTests()`（画面ボタン）で T1〜T10 全 PASS。

### 9.2 デザイン忠実度

1. ブレインストーミングで選定した **R3 Table-First** と同じ合計ストリップ / テーブル構成。
2. 4 フォント（Shippori Mincho / Fraunces / Zen Kaku Gothic New / JetBrains Mono）が適用されている。
3. カラートークンが §4.3 どおり。
4. 左パネルのステップ完了インジケータが動作（CSS で可能な範囲）。

### 9.3 レスポンシブ

1. ≥ 960px で 2 カラム。
2. 600–959px で 1 カラムに崩れる。
3. ≤ 600px でフォーム縦並び、テーブル横スクロール。

### 9.4 モーション

1. ページロード時のスタガー登場が見える。
2. OS レベルで `prefers-reduced-motion: reduce` を有効化すると全アニメが止まる。

### 9.5 オフライン挙動

- Google Fonts 未ロード時（機内モードで開いた場合）もフォールバックで崩壊しない（§4.1 のフォールバック指定）。

### 9.6 完了基準

上記 §9.1〜§9.5 すべて目視確認 + 組み込みテスト 10 件 PASS。

## 10. 変更ファイル一覧

| ファイル | 扱い |
|---|---|
| `index.html` | 全面書き換え（DOM 契約は §8 を遵守） |
| `style.css` | 全面書き換え |
| `app.js` | 変更なし |
| `netlify.toml` | 変更なし |
| `夜勤手当計算アプリ_計画書.md` | 変更なし |

## 11. スコープ外（明示）

- ダークモード
- 多言語対応
- 国際化された通貨フォーマット（`¥` と 3 桁区切り `toLocaleString('ja-JP')` のみ、現行挙動を維持）
- フォントの自前ホスティング（採用は Google Fonts CDN、承諾済み）
- 計算ロジックの拡張（CAP チップのような表示強化は今回スコープ外。`app.js` を触らない方針）
