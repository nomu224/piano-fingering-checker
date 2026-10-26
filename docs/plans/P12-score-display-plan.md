# 楽譜の表示と現在位置のハイライト(F-11)実装計画

## 背景・目的

タブレットを三脚で固定し、鏡で鍵盤を写す構成(9 章)では**紙の楽譜を置く場所がない**。
また「次に弾く音」だけの表示では曲の流れが分かりにくい(開発者要望 2026-10-26)。

そこで**画面に五線譜を表示し、いま弾く位置を色で示す**。仕様書に F-11 として追加済み。
あわせて 2.2「やらないこと」から楽譜表示を外し、5 章に楽譜描画ライブラリを追記済み(変更履歴に記載)。

完了条件(段階ごと):

- **段階 1**: 練習画面に楽譜が表示され、タブレット横持ち(960×600 相当)で**スクロールなしに**読める。
  楽譜を出せない曲でも練習は続けられる
- **段階 2**: いま弾くべき音が色で示され、演奏が進むと表示が追従する
- **段階 3**(今回やらない): ミスした音符に色が付く

## 仕様書の該当章

- **F-11**: 五線譜の表示 / 現在位置の色表示と追従 / 外部ライブラリ可 / 判定エンジンは楽譜表示に依存しない /
  表示できなくても練習は続けられる / 対応づけは変換時に記録した位置情報を使う / 段階的実装
- **8.1(更新済み)**: 各イベントに `onsetQuarters`(小節内の発音位置、四分音符単位)。
  変換元 MusicXML 本文もあわせて保存する(判定には使わない)
- **5 章(更新済み)**: 楽譜描画は OpenSheetMusicDisplay。表示するときだけ読み込む
- F-04 / F-09: 内蔵曲・追加曲どちらも対象。曲の切り替えに追従すること
- F-05 / 7.1: 判定とスコアフォローは**一切変更しない**
- 9 章: タブレット横持ちが基本。スクロールなしで主要情報が収まること
- 10 章: Android ミドルレンジで手認識 10fps 以上を保つこと

## 外部ライブラリ(承認済み 2026-10-26)

**OpenSheetMusicDisplay 2.2.1**(BSD-3-Clause、配布物 約 2.3MB、内部で VexFlow 1.2.93 を使用)。
バージョンは `^` を付けずに**固定**する(描画の見た目が変わりやすいため)。

- 注意: **ESM ビルドを持たない(UMD)**。動的 import の戻り値は
  `mod.OpenSheetMusicDisplay ?? mod.default?.OpenSheetMusicDisplay` の形で受ける
- ビルド時に chunk size 警告が出る見込み(異常ではない)

## やらないこと

- 判定エンジン・スコアフォロー・運指判定・カメラ処理の変更
- 楽譜の編集、移調、自動演奏(再生)
- 紙の楽譜の画像/PDF 取り込み、楽譜からの運指の自動推定
- 段階 3(ミス箇所の色付け)
- **反復記号(リピート)への対応**。変換側は反復を展開しないため、反復のある曲では
  2 回目以降の対応づけができない。既知の限界として README に書く
- 内蔵テスト曲「ドレミファソファミレド」(doremi)の楽譜表示。
  この曲は MusicXML が存在しない手書きデータなので、**楽譜なしの曲の実例**として扱う

## 段階 1: 楽譜を表示する

### 1-1. 変換の拡張(`src/songs/musicxml.ts`)

現在の変換は `<divisions>` を**読んでいない**(176 行目のコメントのとおり、小節内の相対時刻の一致だけを見ている)。
そのため「既存の time を divisions で割る」ことはできない。**四分音符単位の時刻を別に累積する**。

- `<attributes>` を走査して `divisions` を読む。小節をまたいで持続する。
  冒頭に無い場合は既定値 1 とし、警告を出す
- 小節内で `divisions` が変わっても正しくなるよう、**加算の時点で割る**:
  - 音符: `qTime += duration / currentDivisions`
  - `<backup>`: `qTime -= duration / currentDivisions`、`<forward>`: `qTime += …`
  - `<chord/>`: 直前の音と同じ位置(`lastQTime` を再利用)
- 同時発音のグルーピングも**この四分音符時刻で行う**(情報源を 1 つにして、
  イベントと `onsetQuarters` が必ず一致するようにする)。
  既存 2 曲は `divisions` が一定なので、再生成しても結果は変わらない
- **小数の安定化(重要)**: `duration / divisions` は 3 連符などで循環小数になる。
  丸め関数を 1 つ作り(小数第 6 位・`-0` は `0` に正規化)、
  **累積値の代入時と、同時発音をまとめるキーの生成時の両方**で必ず通す。
  これを怠ると `0.3333333333333333` と `0.33333333333333337` で**和音が別イベントに割れ、
  判定(スコアフォロー)の挙動まで変わる**
- 小節番号は `number` 属性を優先し、整数かつ 1 以上でなければ出現順(`index + 1`)にする(弱起対策)。
  楽譜側と突き合わせるため、**イベントには `measure` に加えて `measureIndex`(0 始まりの出現順)も持たせる**
- **`convertMusicXml` の戻り値に XML 本文は含めない**
  (`tests/songs/musicxml.test.ts` が `toEqual` で JSON 全体を比較しているため)

### 1-2. MusicXML の持ち方(`src/songs/` 配下)

Song 型には XML を入れず、**曲 ID から XML を取り出す関数**を用意する(core の型を汚さないため)。

```ts
// src/songs/musicXmlStore.ts(新規)
export async function getSongMusicXml(songId: string): Promise<string | null>
export function saveUserSongMusicXml(songId: string, xml: string): boolean  // 保存できたか
export function removeUserSongMusicXml(songId: string): void
```

- localStorage へのアクセスは `userSongs.ts` と同じ流儀にする
  (プライベートモードでは `globalThis.localStorage` の参照自体が例外になるため、try/catch で包む)
- **孤児キーの掃除**: 読み込み時に、曲一覧に無い ID の XML キーを削除する
  (保存失敗や旧データで取り残しが出るため)
- 内蔵曲 ID → XML の対応表は**曲レジストリ(`src/songs/index.ts`)の隣に置く**
  (store 側に散らすと、曲を足したときに「JSON は増えたが楽譜だけ出ない」ズレが起きる)
- 内蔵曲: `gakufu/*.musicxml` を Vite の `?raw` で読み込む。
  **ファイルをコピーしない**(実ファイル一致テストが `gakufu/` を見ているため、二重管理になると
  「テストは通るのに画面の楽譜だけ古い」事故が起きる)
- 追加曲(F-09): **曲ごとに別のキー**で localStorage に保存する(例: `…:user-song-xml:<id>`)。
  今の `userSongs.ts` は全曲を 1 キーにまとめているため、そこに XML を混ぜると
  起動のたびに全 XML を読む・1 曲の失敗で全曲が保存できない、という問題が起きる
- **容量対策**: 1 曲あたりの上限は **50 万文字(≒1MB)**。
  ※ localStorage は 1 文字あたり約 2 バイト消費するため、バイト数ではなく**文字数**で判定する
  (内蔵 2 曲は 25KB / 30KB なので通常は余裕がある)。上限を超える XML は保存しない。
  `QuotaExceededError` が出た場合も**曲データだけ保存して XML はあきらめる**
  (F-11「表示できなくても練習は続けられる」に沿う)。どちらの場合も画面に理由を出す
- 曲を削除したら XML のキーも消す
- スキーマ検証(`userSongs.ts`)に、**あれば検証・無ければ無視**で次を足す:
  `onsetQuarters` は有限かつ 0 以上の数、`measureIndex` は 0 以上の整数

### 1-3. 楽譜表示コンポーネント(`src/components/ScoreView.tsx`)

- props: `musicXml: string | null` / `position: ScorePosition | null`(段階 2 で使う)
  → **OSMD のインスタンスを親に渡さない**。OSMD への依存はこのファイルだけに閉じ込める
- `musicXml` が null なら何も描かない(呼び出し側が従来の「次に弾く音」を出す)
- OSMD は**動的 import**。読み込み中・失敗時の表示を出し、失敗しても練習は続けられる
- 設定: `drawFingerings: true` / `drawTitle: false` / `autoResize: false`
- **表示倍率**: 楽譜の高さは 40dvh(960×600 なら約 240px)で大譜表 1 段がほぼ限界。
  `osmd.zoom`(0.5〜0.7 程度)を実機で詰める。読めない場合の代替として、
  横 1 段で表示して横スクロールさせる設定(`RenderSingleHorizontalStaffline` 相当)も検討する
- **楽譜が無い曲(doremi など)では空白にせず**、「この曲は楽譜データがありません」と出して
  従来の表示に戻す(起動直後の既定曲が doremi なので、この表示が最初に見える)
- 再描画の条件は **`musicXml` が変わったときだけ**(`song.id` で判定。`getAllSongs()` は
  呼ぶたびに新しいオブジェクトを返すため、オブジェクト参照で比較しない)
- 後始末: 動的 import の解決前にアンマウントされた場合は中断する。アンマウント時にコンテナを空にする
- 画面の回転・サイズ変更時は、**実際に幅が変わったときだけ**描き直す(回転に追従するため)

### 1-4. 練習画面への組み込み(`src/components/PracticeScreen.tsx`)

- 楽譜の表示/非表示は**練習画面のボタン**で切り替える(既定: 表示)。
  判定に関係しない表示設定なので、`PracticeSettings`(core の型)には入れない
- 横持ちのレイアウト(9 章のスクロールなしを守るため、**カメラを小さくして場所を作る**):
  - 上段: 楽譜(横幅いっぱい、高さ約 40dvh)
  - 下段: 左=カメラ映像(`cam-frame` を 36dvh → **24dvh** に縮小)/ 右=次に弾く音・直前の判定
  - 「次に弾く音」の文字サイズの上限を下げる(56px → 40px 程度)
  - 楽譜が非表示・表示できない曲のときは**従来のレイアウトのまま**(カメラは 36dvh に戻す)
- 縦持ち・PC では楽譜を上に置いて従来どおり縦積み

### 1-5. PWA の設定(`vite.config.ts`)

OSMD のチャンク(約 2.3MB)は `dist/assets/*.js` に出るため、**そのままでは precache に入り、
Service Worker の更新のたびに全量ダウンロードになる**。

- OSMD を固定名のチャンクに分ける(`rollupOptions.output.manualChunks` で `osmd`)。
  出力名はハッシュ付き(`assets/osmd-[hash].js`)になる
- workbox の `globIgnores: ["assets/osmd-*.js"]`(dist 基準の相対パス・先頭の `/` なし)で precache から外し、
  `runtimeCaching` に `urlPattern: /\/assets\/osmd-.*\.js$/` + CacheFirst を足す
- **OSMD を静的 import してはいけない**(型だけの import を除く)。
  1 か所でも静的 import すると起動時に読み込まれ、動的 import の意味が消える
- dev サーバーで再読み込みが走る場合は `optimizeDeps.include: ["opensheetmusicdisplay"]` を検討する

### 1-6. 確認(段階 1)

1. 960×600 で楽譜が読めること(音符の大きさ・1 行に入る小節数)。**スクロールが出ないこと**
2. 390×844(縦持ち)・1280×800(PC)で崩れないこと
3. 楽譜を非表示にすると従来のレイアウトに戻ること
4. 楽譜のない曲(doremi)・古い保存データでも練習できること
5. 曲を切り替えると楽譜も切り替わること。曲の追加・削除で無駄な再描画が起きないこと
6. **楽譜の表示が OFF のときは OSMD を読み込まないこと**(通信を見て確認)
7. 楽譜表示中に手認識の fps が落ちないこと(**ON/OFF で数値を比べる**。10 章)

## 段階 2: 現在位置のハイライトと追従

### 2-1. 位置の対応づけ(`src/components/scoreCursor.ts`・純 TS・テスト対象)

```ts
interface ScorePosition { measureIndex: number; onsetQuarters: number }
function toScorePosition(event: ScoreEvent): ScorePosition | null  // 情報が無ければ null
function comparePosition(a: ScorePosition, b: ScorePosition, epsilon?: number): number
```

- **音符の並び順では対応づけない**(変換時に休符・タイ・装飾音を除外しているためズレる)
- 比較には**許容誤差(既定 1e-4)**を使う(小数の誤差対策)
- OSMD 側の現在位置は、反復子から次のように取る:
  - 小節: `iterator.CurrentMeasureIndex`(印刷上の番号ではなく**出現順**。弱起対策)
  - 小節内の位置: `(iterator.currentTimeStamp - iterator.CurrentMeasure.AbsoluteTimestamp).RealValue * 4`
    (OSMD の時刻は**曲頭からの絶対時刻・全音符 = 1** なので、小節頭を引いてから 4 倍して四分音符単位にする)
- 進め方: 前へ進むときは `cursor.next()` を繰り返す。**戻るときは `cursor.reset()` してから進め直す**
  (やり直し・小節指定開始・弾き飛ばし救済に対応)
- **走査中はカーソルを隠す**(`cursor.hide()` → 目的地に着いたら `show()`)。
  `next()` は 1 回ごとに DOM を更新するため、長い曲で戻ると数百回の更新が一気に走る
- 打ち切り: `iterator.EndReached` を見て止める。上限は**曲のイベント数から算出**(固定値にしない)。
  **一致が見つからなければハイライトを消す**(誤った位置に残さない)

### 2-2. ハイライトと追従(`ScoreView.tsx`)

- まず `cursor.show()` によるカーソル表示で現在位置を示す(確実に動く方法)
- 音符自体の着色は、**install 後に API の実在を確認してから**決める。
  OSMD で一般的な着色は「色を設定して再描画」で、演奏のたびに再描画するのは重い。
  再描画なしで着色できる方法が無ければ、**段階 2 はカーソル表示のみ**とし、着色は段階 3 に回す
- 色を付けた場合は、**次の移動で必ず元に戻す**(やり直し時は全部初期化)
- カーソルが画面外に出たらその位置までスクロールする。
  **まず OSMD の追従機能(`cursorOptions` の `follow` など)を試し**、
  自前の `scrollIntoView` は最後の手段にする(ページ全体が動く事故が起きやすい)
- 演奏が終わったときのカーソルの扱い(最後の音に残す)を決めておく
- 演奏中は**カーソル移動だけ**で、再描画はしない

### 2-3. 確認(段階 2)

1. **休符・和音を含む曲**(かっこう・ロンドン橋)で、色が付く位置と実際に弾く音が一致すること
   ※ 内蔵 2 曲にタイは無いので、タイの確認はユニットテスト(合成 XML)で行う
2. 「やり直す」「n 小節目から開始」でカーソルが正しく戻ること
3. **弾き飛ばし救済(skipJump)**で先へ飛んだときも追従すること
4. 和音の一部だけ押した状態ではカーソルが進まないこと
5. 一時停止中も表示が崩れないこと
6. 曲の最後まで弾いてもカーソルが暴走・例外を出さないこと
7. 長い曲でスクロールが追従すること

## 対象ファイル

```
src/
  songs/
    musicxml.ts            # (変更)四分音符時刻の累積 → onsetQuarters / measureIndex
    musicXmlStore.ts       # 【新規】曲 ID → MusicXML(内蔵は ?raw、追加曲は専用キー)
    userSongs.ts           # (変更)XML の保存/削除の呼び出し、検証の追加
    index.ts               # (変更)内蔵曲の XML 参照
    *.json                 # (再生成)kakkou / london-bridge
  core/types.ts            # (変更)ScoreEvent に onsetQuarters? / measureIndex? を追加(値は判定に使わない)
  components/
    ScoreView.tsx          # 【新規】楽譜の描画(OSMD は動的 import)
    scoreCursor.ts         # 【新規】位置の対応づけ(純 TS)
    PracticeScreen.tsx     # (変更)楽譜の配置・表示切替・カーソル連動
    SongImport.tsx         # (変更)読み込んだ XML 本文を保存
  index.css                # (変更)楽譜の配置、カメラ枠の縮小
vite.config.ts             # (変更)OSMD チャンクの分離と precache 除外
```

## テスト

- 既存 192 件が通ること(`src/core` は型の追加のみ)
- `tests/songs/musicxml.test.ts` に追加:
  - 3 拍子の 1・2・3 拍目の `onsetQuarters`
  - `divisions` が 2 以上の曲 / **小節の途中で divisions が変わる曲**
  - `<backup>` を使う両手譜で左手の位置が正しいこと
  - `<chord/>` の 2 音目が直前と**同じ** `onsetQuarters` になること
  - 休符・タイ・装飾音を挟んでも位置がずれないこと
  - `<divisions>` が無い譜面で既定値 1 が使われ、警告が出ること
  - 弱起(`number="0"`)で `measureIndex` が正しいこと
  - 実ファイル一致テスト(かっこう・ロンドン橋)が通ること
- `tests/components/scoreCursor.test.ts`(新規):
  - 位置の比較(前・後・同じ)、許容誤差の範囲内なら同じと判定すること
  - 情報の無いイベントで null を返すこと
- `tests/songs/userSongs.test.ts`(あれば追加、無ければ新規):
  - `onsetQuarters` の無い古いデータが読めること
  - XML が大きすぎる場合に保存を拒否し、曲データだけ保存されること
- `ScoreView.tsx`(OSMD 依存)はユニットテストを書かない。ブラウザで目視確認する

## 実装手順(作業単位ごとに commit)

1. 仕様書(F-11 / 8.1 / 2.2 / 5 章)の更新と本計画を commit
2. `npm install opensheetmusicdisplay@2.2.1`(承認済み)→ commit
3. 変換の拡張(`onsetQuarters` / `measureIndex`)+ テスト + 内蔵曲 JSON の再生成 → commit
4. `musicXmlStore.ts`(内蔵曲の `?raw` 読み込み・追加曲の保存/削除・容量対策)+ テスト → commit
5. `ScoreView.tsx`(表示のみ)+ 練習画面への配置 + 表示切替 + `vite.config.ts` の PWA 設定
   → ブラウザ確認(1-6 の全項目)→ commit
6. **push してタブレットで見やすさを確認してもらう(段階 1 完了)**
7. `scoreCursor.ts` + テスト → commit
8. ハイライトと追従 → ブラウザ確認(2-3 の全項目)→ commit
9. README(楽譜表示の説明と**反復記号の限界**)/ `docs/android-check.md` / CLAUDE.md 進捗ログ /
   つまずいた点があれば LESSONS.md → commit → push → 実機確認を依頼

## 技術的な注意点・リスク

- **対応づけのズレが最大のリスク**。確認では必ず「色が付いた位置」と「実際に弾く音」を目で突き合わせる
- **描画の重さ**: 曲の切り替え時のみ描画し、演奏中はカーソル移動だけにする。
  タブレットで fps を ON/OFF 比較して確認する
- **反復記号**: OSMD の反復子は反復を展開して進むが、変換側は展開しない。
  反復のある曲では 2 回目以降がズレる(既知の限界として明記する)
- **保存容量**: localStorage は 5MB 程度。XML は曲ごとに分けて保存し、超過時は XML を捨てて曲だけ残す
- **古い保存データ**: `onsetQuarters` が無くても落ちないこと(楽譜なしで練習できる)
- **OSMD の API**: `cursor` 周りの名称は版で揺れがある。install 後に型定義で実在を確認してから使う
