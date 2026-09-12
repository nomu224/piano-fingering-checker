# 楽譜ファイルの追加(F-09)実装計画

## 背景・目的

曲を増やすたびに `src/songs/index.ts` へ import と配列追加を書く運用は現実的でない。
2026-09-12 に開発者の要望で **仕様書に F-09「楽譜ファイルの追加」を追加**(変更履歴に記録済み)。

完了条件: **アプリ内で運指付き MusicXML を選ぶと曲一覧に追加され、次回起動時も選べる**。

## 仕様書の該当章

- **F-09**: 運指付き MusicXML(非圧縮)をアプリ内で読み込み、曲一覧に追加 /
  **変換ロジックは 8.2 の変換スクリプトと同一のものを共有** / ブラウザに保存して次回も選べる /
  削除できる / 変換警告を表示 / 読み込めないファイルはエラー表示 / MIDI は対象外
- 2.2: MIDI アップロードは対象外(運指を持てないため)。MusicXML は F-09 で対応
- 8.1: 楽曲 JSON スキーマ / 8.2: 変換スクリプト
- 5 章: 外部ライブラリは最小限
- 10 章: 端末外に送信しない(読み込みも保存もすべてブラウザ内で完結)

### 8.2 との建て付け(逸脱に見えないよう明記)

8.2 の「アプリ本体には含めず、開発時ツールとする」は **CLI スクリプト本体**(引数処理・ファイル IO)を指す。
F-09 が「同一ロジックの共有」を要求するため、**共通の変換ロジックは `src/` に置き**、
`tools/` の .mjs は CLI ラッパーとして残す。依存の向きは **tools/ → src/ の一方向**とし、
src/ は tools/ を参照しない。

## やらないこと

- **圧縮 MusicXML(.mxl)の対応** — zip 展開に依存が必要。非圧縮のみ(既存 CLI と同じ制約)。
  ただし .mxl を選ばれたときの**案内は出す**(下記 5.)
- **MIDI ファイルの読み込み** — 2.2 で明確に対象外(運指が無いため)
- 楽譜の表示(2.2 で将来拡張)/ 曲の編集機能(運指の修正は MuseScore 側で行う)
- クラウド保存・共有(10 章のプライバシー方針)

## 設計: 変換ロジックを文字どおり 1 つにする

F-09 は「**8.2 の変換スクリプトと同一のロジックを共有**」と明記している。

### 採用案: `fast-xml-parser` をアプリ本体でも使う

`convertMusicXml(xmlText, meta)` を `src/songs/musicxml.ts` に移し、**CLI とアプリが同じ関数を呼ぶ**。
XML の解析も同じパーサを使うため、**変換結果が食い違う余地が原理的に無い**。

- `fast-xml-parser` は既にプロジェクトにある(P5 で CLI 用に devDependency として承認済み)。
  これを `dependencies` に移す。**新しいライブラリの追加ではない**
- バンドル増加は約 15KB(gzip)。MediaPipe の WASM/モデル(約 42MB)を読むアプリなので実質無視できる

### 検討したが採らなかった案: ブラウザ標準 `DOMParser` で自作

「アプリ本体の依存ゼロ」という利点はあるが、**ブラウザ用と CLI 用で 2 つのアダプタを書くことになり、
F-09 が避けたい「結果の食い違い」を生む新しいバグ面を自分で作ることになる**。
さらに `DOMParser` は Node に無いため、その経路を自動テストするには結局テスト用ライブラリ
(jsdom 等)が必要になり、「依存ゼロ」も実質崩れる。以下の差異を人手で吸収し続ける必要もある:

- fast-xml-parser はテキストを数値化する(`<divisions>1</divisions>` → 数値 1)
- 「要素が無い(undefined)」と「要素はあるが空("")」の区別 — `staff` の右手フォールバック判定が依存
- 空白テキスト・コメントノードの扱いの差

**採用案ならこれらの問題がすべて消える**ため、採用案を選ぶ。

## ディレクトリ構成(追加・変更分)

```
src/
  songs/
    musicxml.ts        # 【新規】convertMusicXml() を CLI から移設(純TS・テスト対象)
    userSongs.ts       # 【新規】追加した曲の localStorage 保存・読込・削除・検証
    index.ts           # (変更)内蔵曲 + 追加曲をまとめて返す
  components/
    SongImport.tsx     # 【新規】ファイル選択 UI・警告/エラー表示・削除
    PracticeScreen.tsx # (変更)曲選択欄の隣に SongImport を置く
tools/
  musicxml2json.mjs    # (変更)CLI ラッパーのみに。変換は src/songs/musicxml.ts を import
tests/
  songs/
    musicxml.test.ts   # 既存 tests/tools/musicxml2json.test.ts を移設(12 件)+ 実ファイル一致テスト
    userSongs.test.ts  # 【新規】保存・読込・削除・壊れたデータ・ID衝突
```

## 実装内容

### 1. `src/songs/musicxml.ts`(変換ロジックの移設)

- `tools/musicxml2json.mjs` の `convertMusicXml` と XML ヘルパーを**そのまま TypeScript に移設**
  (**挙動は一切変えない**。既存 12 件のテストが無修正で通ることが証明になる)
- **`childText()` は「要素が無い → `undefined`」を維持する**こと。
  `staff` が無い音符を右手にフォールバックする判定(`staffText === undefined`)がこれに依存しており、
  ここを `""` にすると **staff 無し譜面が静かに全部右手になる**
- `convertMusicXml(xmlText, meta)` の**名前・引数・戻り値 `{song, warnings}` を維持**する

### 2. `tools/musicxml2json.mjs`(CLI ラッパー化)

- 引数処理・ファイル IO・警告出力だけを残し、変換は `src/songs/musicxml.ts` を import
- **Node の型ストリップで .ts を読む際の制約**(Node 22.18+ で既定有効。環境は v22.23.1 で確認済み):
  - 値の import は **`.ts` 拡張子を明記**(`import { convertMusicXml } from "../src/songs/musicxml.ts"`)
  - 型のみの import は必ず **`import type`**(そうしないと実行時に解決しようとして落ちる)
  - `enum` / `namespace` / パラメータプロパティは使わない
    → **tsconfig に `"erasableSyntaxOnly": true` を追加**して機械的に防ぐ
  - **`package.json` に `"engines": { "node": ">=22.18" }` を追加**し README にも記載
  - ※ CI(deploy.yml)は `npm run build` のみで CLI を実行しないため、**CLI の破損は CI で検出されない**。
    手順 2 の完了条件に `npx tsc --noEmit` と CLI の実行確認を含める

### 3. `src/songs/userSongs.ts`(追加曲の保存)

- localStorage キー: `piano-fingering-checker:user-songs`
- `loadUserSongs()` / `addUserSong(song)` / `removeUserSong(id)`
- **モジュール読み込み時に localStorage へ触れない**(テスト環境は node で localStorage が無いため)。
  アクセスは関数内で遅延実行し、**読み書きとも try/catch**(プライバシーモードでは例外になる)
- **スキーマ検証**(localStorage はユーザーが書き換えられるため、そのまま信用しない):
  `id`(非空 string)/ `title`(string)/ `difficulty`(number)/ `events`(配列)、
  各 event の `index`・`measure`・`posInMeasure`(number)、
  各 note の `midi`(0〜127 の整数)/ `finger`(null または 1〜5)/ `hand`(`"L"|"R"`)
  → **`hand` と `finger` は判定エンジンが直接使うため、汚れると運指判定が静かに壊れる**
  → **壊れた 1 曲だけを捨て、残りは活かす**(全体を空にしない)
- 容量超過(QuotaExceededError)は分かりやすいエラーにする
- 保存は端末内のみ(10 章)

### 4. ID と曲名の決め方(**重要**: これが無いと 2 曲目が 1 曲目を上書きする)

既存 CLI は `--id` `--title` で受け取るため、アプリ側で渡さないと **id は常に `"converted-song"`** になり、
読み込むたびに前の曲を上書きしてしまう。また実ファイルの `<work-title>` は MuseScore 既定の
「無題のスコア」であることが多く、曲名として使えない。

- **id**: アプリ側で一意に生成して meta に渡す(例 `user-<時刻>-<連番>`)。
  さらに保存時に**内蔵曲・既存の追加曲と衝突しないよう連番を振る**(「同じ id なら置き換え」はしない)
- **title**: **ファイル名(拡張子を除く)を優先**。空なら `<work-title>`、それも空なら「無題」。
  同名が既にある場合は `(2)` を付ける

### 5. `components/SongImport.tsx`(UI)

- 「楽譜を追加(MusicXML)」ボタン → `<input type="file" accept=".musicxml,.xml">`
- **パース前のファイル種別チェック**(最頻の失敗を分かりやすく案内する):
  - **`.mxl`(圧縮 MusicXML)**: **MuseScore 4 のエクスポート既定がこれ**なので最も起きやすい。
    拡張子に加え**先頭 4 バイトの ZIP シグネチャ `PK\x03\x04`** も見る(`.xml` にリネームされた .mxl も捕まる)
    → 「圧縮 MusicXML(.mxl)は対応していません。『エクスポート → MusicXML』で**非圧縮**を選んでください」
  - **MIDI**(`.mid`/`.midi`、または先頭が `MThd`)
    → 「MIDI には運指が入らないため使えません。MusicXML(非圧縮)で書き出してください」
- 成功: 曲一覧に追加してその曲を選択状態にし、**変換警告があれば一覧表示**
- 失敗: 日本語のエラー(XML が壊れている / MusicXML でない / 音符が無い 等)
- 追加曲の**削除ボタン**
- **ファイルピッカーから戻った後**(Android では一度バックグラウンド化する):
  `AudioContext` が suspended になるため **`resumeAudio()` を呼ぶ**。
  カメラの映像トラックが生きているかも確認する(F-03: カメラが変わると再キャリブレーションが必要)

### 6. `PracticeScreen.tsx`(組み込み)

- 曲選択欄の隣に `SongImport` を置く
- **`getAllSongs()` は曲オブジェクトの同一性を保つ**こと(追加・削除時のみ再計算)。
  毎レンダリングで新しいオブジェクトを作ると、
  `judgeSongRef.current !== song` の参照比較が毎回成立して**判定エンジンが作り直され進行が消える**
- **選択中の曲を削除した場合**は先頭の曲にフォールバックする
  (そうしないと選択欄が空になり、削除済みの曲で判定が動き続ける)
- 追加・削除時のリセットは既存の曲切替と揃える:
  `setSong / setLastEntry(null) / setMessage("") / setPaused(false) / onMark(null)`
  **+ `setShowResult(false)`**(既存の曲切替はこれが漏れており、結果画面が残ってしまう)

## テスト

- `tests/songs/musicxml.test.ts`:
  - 既存 `tests/tools/musicxml2json.test.ts` の 12 件を**移設し、import 先を変えるだけで通す**
    (挙動が変わっていないことの回帰網)
  - **実ファイル `gakufu/kakkou.musicxml` を変換し、`src/songs/kakkou.json` の `events` と一致**することを確認
    (id/title/difficulty は CLI の引数由来なので比較対象外)
- `tests/songs/userSongs.test.ts`: 保存/読込/削除、壊れた JSON を無視、壊れた曲だけ捨てる、ID 衝突、
  localStorage が使えない環境でも落ちない(最小モックを用意)

## 実装手順(作業単位ごとに commit)

1. 本計画を commit
2. `fast-xml-parser` を dependencies へ + 変換ロジックを `src/songs/musicxml.ts` へ移設 +
   CLI をラッパー化 + テスト移設 → **既存 12 件が通る / `npx tsc --noEmit` / CLI 実行**を確認 → commit
3. `userSongs.ts` + テスト → commit
4. `index.ts` の統合 + `SongImport.tsx` + 画面組み込み → ブラウザ確認 → commit
5. README / CLAUDE.md 進捗ログ更新 → commit

## 完了条件と検証

- `npm run test` 全件パス / `npm run build` 成功 / `npx tsc --noEmit` エラーなし
- **CLI が従来どおり動く**(`node tools/musicxml2json.mjs gakufu/kakkou.musicxml --id x --title y`)
- ブラウザ:
  1. `gakufu/kakkou.musicxml` をアプリから読み込むと曲一覧に追加される
  2. **アプリでの変換結果の `events` が `src/songs/kakkou.json` の `events` と一致する**
     (id/title はメタ情報なので対象外)
  3. **2 曲目を読み込んでも 1 曲目が消えない**
  4. ページを再読み込みしても追加した曲が残っている
  5. 削除すると一覧から消え、再読み込み後も消えている。選択中の曲を削除しても画面が壊れない
  6. MIDI ファイル / .mxl を選ぶとそれぞれ専用の案内が出る
  7. 壊れたファイルを選んでもアプリが落ちず、エラー表示が出る
  8. 追加した曲を実際に弾いて判定が動く
- Android 実機(docs/android-check.md に項目追加):
  楽譜追加の後もカメラ・参照音が生きていること

## 技術的な注意点

- localStorage は同期 API。`setItem` は原子的なので容量超過で既存データが壊れることはない
- 実測: `kakkou.musicxml` 25KB → JSON 6KB。localStorage 5MB なら数百曲入る
- 追加曲の JSON はユーザーが編集可能な領域にあるため、**読み込み時に必ず形を検証**する
