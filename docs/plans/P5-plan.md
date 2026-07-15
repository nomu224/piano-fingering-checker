# P5 実装計画: 結果サマリー(F-06/S-05) + 設定(F-07/S-06) + MusicXML 変換スクリプト(8.2)

## 目的

仕様書 11 章 P5「結果サマリー + 設定 + バイエル曲データ整備」を実装する。
完了条件: **一連の練習フロー(練習 → 終了 → 結果 → 設定変更 → 再練習)が通る**。

## 仕様書の該当章

- F-06 結果サマリー: 曲(または中断)終了後に表示 / 総打鍵数・運指ミス数・音ミス数・判定不能数 /
  譜面位置ごとのミス一覧(「◯小節目の◯番目の音: 3 の指のところを 2 で弾いた」)/
  **判定ログの JSON ダウンロード**(卒論の精度評価実験用)
- 7.1: 最終イベント達成をもって演奏終了とし、**自動で結果画面(S-05)へ遷移**
- F-07 設定: フィードバック音の ON/OFF・音量 / 判定の厳しさ(判定不能を「無視」or「ミス扱い」)/
  左手/右手/両手の判定対象切替。S-06 はモーダルで可
- F-05: 正解は「無音(または設定でクリック音)」→ クリック音の設定も F-07 側で実装
- 8.2 変換スクリプト: `tools/` に MusicXML → 楽曲 JSON の変換(Node.js)。アプリ本体には含めない開発時ツール
- 8.1: 運指未指定は `finger: null` / 同一イベント内の同ノート番号(左右同鍵)は変換スクリプトで警告
- 8.3 初期収録曲: バイエル 3 曲程度(片手 1 + 両手 2)+ テスト曲

## P5 でやらないこと・できないこと

- 正式な画面フロー S-01→S-06 の再構成(P6 の Android 対応と合わせて実施)。開発用タブ構成は維持
- 実 MIDI デバイス入力(P6 の実機検証と合わせて)
- **バイエル曲の実データ投入**: 元データ(運指付き MusicXML)は開発者が MuseScore 等で入手する必要がある(仕様 8 章)。
  P5 では変換スクリプトと手順(README)まで用意し、実データはファイル入手後に変換して追加する
- 設定の永続化(localStorage)。仕様に規定が無いためメモリ内のみ(キャリブレーション F-03 と同じ扱い)

## 外部ライブラリの追加(要承認)

変換スクリプトの XML パースに **fast-xml-parser を devDependency として追加**したい。
- 理由: MusicXML は入れ子の深い XML で、自前パースは壊れやすい。fast-xml-parser は依存ゼロ・実績多数
- アプリ本体(dist)には一切入らない(tools/ の開発時ツールのみが使用)

## ディレクトリ構成(追加・変更分)

```
src/
  core/
    types.ts            # (追記)PracticeSettings 型 / FingeringJudgment に handNotTarget を追加
    constants.ts        # (追記)設定の既定値 DEFAULT_SETTINGS
    judge.ts            # (変更)設定(判定の厳しさ・判定対象の手)を反映。ライブ変更用 setter
  audio/
    feedback.ts         # (変更)ON/OFF・音量・正解クリック音に対応
  components/
    ResultScreen.tsx    # S-05 結果サマリー(集計・ミス一覧・JSONダウンロード・もう一度)
    SettingsModal.tsx   # S-06 設定モーダル
    PracticeScreen.tsx  # (変更)終了時に結果画面へ自動遷移 / 中断して結果を見るボタン / 設定ボタン
tools/
  musicxml2json.mjs     # MusicXML → 楽曲 JSON 変換(CLI + 変換関数 export)
tests/
  core/judge.test.ts    # (追記)設定反映のテスト
  tools/
    musicxml2json.test.ts # 変換関数のユニットテスト(フィクスチャ XML 文字列で検証)
```

## 実装内容

### 1. 設定(F-07)

`core/types.ts` に設定型を追加(純データ。UI から judge / feedback に配る):

```ts
interface PracticeSettings {
  feedbackEnabled: boolean;   // フィードバック音 ON/OFF
  feedbackVolume: number;     // 音量 0〜1
  clickOnCorrect: boolean;    // 正解時にクリック音(F-05「または設定でクリック音」)
  undeterminedAsMiss: boolean; // 判定の厳しさ(判定不能を「ミス扱い」にするか)
  targetHands: "both" | "R" | "L"; // 判定対象の手
}
```

- `constants.ts` に `DEFAULT_SETTINGS`(音 ON・音量 0.3・クリックなし・判定不能は無視・両手)
- **判定対象の手の解釈**: 運指判定のみを対象を絞る(スコアフォロー=音判定は全 notes で進める。
  対象外の手の note は `fingering: { kind: "skipped", reason: "handNotTarget" }` として記録し、判定不能には数えない)
- `PracticeJudge` に `setUndeterminedAsMiss` / `setTargetHands` を追加(練習中の設定変更を即反映。セッションは切らない)。
  **曲切替などで judge を作り直すときは現在の settings を constructor に渡す**(再生成後も設定が維持されることをテスト。レビュー指摘)
- **クリック音の発火条件(レビュー指摘)**: `JudgmentEntry.feedback` に `"correct"` を追加し、
  **音が正解だった打鍵すべて(duplicateIgnored を除く。運指ミス・ミス扱い判定不能のときは fingerMiss が優先)**で返す。
  UI 側は `feedback === "correct" && settings.clickOnCorrect` のときだけクリック音を鳴らす(F-05「正解: 無音(または設定でクリック音)」)
- `FeedbackSound` に `setEnabled` / `setVolume` / `click()`(短い高音のクリック)を追加
- `SettingsModal.tsx`(S-06 モーダル): 上記 5 項目の UI。App が settings state を保持し、練習画面に配る。
  判定対象の手の項目には**「対象外の手も音判定は行われ、弾かないと曲は進みません」の注記**を表示(解釈の明示。レビュー指摘)

### 2. 結果サマリー(F-06 / S-05)

`ResultScreen.tsx`。表示タイミング(F-06「曲(または中断)終了後」):
- 演奏終了(finished)で**自動遷移**(7.1)
- 練習画面に「練習を終了して結果を見る」ボタン(=中断)を追加
- **実装方式(判定ログの所有権。レビュー指摘)**: ResultScreen は **PracticeScreen(PracticeCore)内の
  条件レンダリング**として表示する。judge(ログ・集計)は PracticeCore の ref に保持されたまま、
  カメラ・HandTracker もアンマウントされない。「もう一度練習する」は judge.restart() して練習表示に戻す

内容:
- 集計: 総打鍵数 / 音ミス数 / 運指ミス数 / 判定不能数(PracticeJudge の counts)
- 譜面位置ごとのミス一覧(判定ログから生成):
  - 運指ミス: 「◯小節目の◯番目の音: 3 の指のところを 2 で弾いた」(F-06 の文言どおり)
  - 音ミス: 「◯小節目の◯番目の音: ソ4 のところを ラ4 を押した」
  - スキップ(未演奏)と判定不能(ミス扱い時)も一覧に含める
- **判定ログの JSON ダウンロード**: 曲 ID・曲名・日時・設定・集計・全ログを 1 つの JSON にして
  Blob + a[download] で保存(卒論の精度評価実験用。ファイル名例: `practice-log_test-doremi_2026-07-07T12-00.json`)
- ボタン: 「もう一度練習する」(restart して練習画面へ)/「閉じる」(練習画面へ戻るのみ)

### 3. MusicXML → JSON 変換スクリプト(8.2)

`tools/musicxml2json.mjs`。変換関数(`convertMusicXml(xmlText, meta)`)を export し、CLI から呼ぶ二層構成
(関数はユニットテスト対象)。

変換ロジック:
- 対象: 非圧縮 MusicXML(`.musicxml` / `.xml`)。MuseScore の「非圧縮 MusicXML でエクスポート」を README で案内
  (圧縮 `.mxl` は非対応と明記)
- 音高: `<pitch>`(step / alter / octave)→ MIDI ノート番号
- **同時発音のグループ化**: `<divisions>` / `<duration>` / `<backup>` / `<forward>` から小節内の発音時刻を追跡し、
  同一時刻の音を 1 イベントにまとめる(`<chord/>` は直前の音と同時刻)。イベントは時刻順、`posInMeasure` は
  小節内の通し番号を自動採番(8.1: タイミング情報は持たない)
- 手: staff 1 = 右手(R)、staff 2 = 左手(L)(ピアノ譜の標準)。staff が無い場合は R とし警告
- 運指: `<notations><technical><fingering>` → finger(1〜5 以外・非数値は警告して null)。無ければ null
- 除外: 休符 / 装飾音(grace)/ タイで繋がれた 2 音目以降
  (**`<tie type="stop">` を持つ音は start の有無によらず除外**。3 音以上のタイ連鎖の中間音も除外される。レビュー指摘)
- 警告(仕様 8.1): 同一イベント内に同じノート番号が複数の手に存在 / 運指未指定の音符数 / 1〜5 以外の運指 /
  **除外した装飾音の個数**(装飾音入りの曲では実演奏時に音ミス化するため気づけるように)
- CLI: `node tools/musicxml2json.mjs input.musicxml --id beyer-08 --title "バイエル 8番" --difficulty 1 --out src/songs/beyer-08.json`
- 変換後は `src/songs/index.ts` のレジストリに 1 行追加すれば曲選択に出る(手順を README に記載)

### 4. テスト

- judge: targetHands="R" のとき左手 note の運指判定がスキップされる / "L"・"both" / ライブ変更 /
  undeterminedAsMiss の setter / **constructor に settings を渡した再生成後も設定が効く** /
  **feedback "correct" が音正解(duplicateIgnored 除く)で返る**
- musicxml2json(フィクスチャ XML で): 単音列の変換(midi・finger・measure・posInMeasure)/
  和音(`<chord/>`)が 1 イベントになる / backup による両手同時が 1 イベントになる /
  staff→hand の対応 / 運指なし→null / **3 音タイの 2・3 音目が除外される** / 休符が除外される / 左右同鍵の警告

## 実装手順(作業単位ごとに commit)

1. 本計画を commit
2. 設定型・judge/feedback の対応 + テスト → commit
3. ResultScreen + 練習画面の遷移(自動遷移・中断ボタン)→ commit
4. SettingsModal + App 結線 → ブラウザ確認 → commit
5. fast-xml-parser 追加(devDep)+ musicxml2json.mjs + テスト → commit
6. README(P5 動作確認手順 + 変換スクリプトの使い方)+ CLAUDE.md 進捗ログ
   (**8.3 のバイエル曲は未充足・MusicXML 入手待ちであることを残件として明記**)→ commit

## 完了条件と検証

- `npm run test` 全件パス(既存 67 件 + 新規)
- `npm run build` が通る(fast-xml-parser がバンドルに入っていないこと)
- ブラウザ(音判定のみモードで可):
  1. テスト曲を最後まで弾く → **自動で結果画面**に遷移し、集計とミス一覧が出る
  2. わざとミスしてから中断ボタン → 結果画面にミスが列挙される(「◯小節目の◯番目の音: …」形式)
  3. JSON ダウンロードで判定ログが保存できる
  4. 設定モーダルで音 OFF → ビープが鳴らない / 音量変更 / クリック音 ON → 正解で鳴る /
     判定の厳しさ・判定対象の切替が judge に反映される(運指判定はカメラありでの確認は開発者に依頼)
  5. 「もう一度練習する」で新しいセッションが始まる
- 変換スクリプト: ユニットテスト + 手元にサンプル MusicXML を作って CLI 実行で JSON が生成されることを確認

## 仕様上の解釈・判断(レビュー観点)

- 「判定対象の手」は**運指判定のみ**に適用(音判定=スコアフォローは全 notes で進行。
  片手だけ判定対象にしても曲は両手分弾かないと進まない、という解釈。7.1 のスコアフォローは手を区別しないため)
- 設定はメモリ内のみ(仕様に永続化の規定なし)
- 中断は「練習を終了して結果を見る」ボタンで明示的に行う(F-06 の「(または中断)終了後」の受け口)
- 結果画面の「もう一度」は同じ曲の新セッション。曲を変えるのは練習画面に戻ってから(S-03 は未実装のため)
- 変換スクリプトは非圧縮 MusicXML のみ対応(.mxl の zip 展開は依存を増やすため。README に明記)
- バイエル実データは MusicXML 入手後に追加(8.3 の完全な充足は入手待ち。変換手順の整備までが P5)
