# 参照音の再生(F-08)実装計画

## 背景・目的

実 MIDI キーボード(microKEY2 等)は音源を持たないため、押しても音が鳴らず練習にならない。
2026-09-03 に開発者の要望で **仕様書に F-08「参照音の再生」を追加**(変更履歴に記録済み)。

完了条件: **鍵盤(実機・バーチャルとも)を押すと、その音の高さの音がすぐ鳴る**。

## 仕様書の該当章

- **F-08**: Note On 受信時に押された音の参照音を Web Audio API で即座に再生 /
  オシレーター(倍音を数本重ねる)+ ADSR(速いアタック・緩やかな減衰)/
  **音源ファイルは読み込まない** / **AudioContext はアプリ起動時に 1 度だけ生成** /
  **発音処理は判定処理より先に呼び出す** / 押された音をそのまま鳴らす(譜面と違っても鳴る)
- 5 章: Web Audio API で「ビープ音と参照音の生成のみ」
- 10 章: 判定遅延 200ms 以内(参照音はさらに手前で鳴るため体感遅延はより小さくなる)
- F-05: 既存のフィードバック音(ビープ A/B・クリック音)とは**別物**。参照音は常に鳴る

## やらないこと

- 音源ファイル(サンプリング音源)の読み込み — F-08 が明確に禁止
- 外部ライブラリの追加(Tone.js 等)— 5 章の方針。**新規依存ゼロ**
- ペダル・ベロシティによる音色変化(仕様 2.2 のスコープ外)。
  **理由**: `NoteMessage`(midi/types.ts)は note と timestampMs しか持たず、velocity を反映するには
  MidiSource インターフェースの変更が必要。今回は広げない
- 設定 UI への参照音の音量項目追加 — **F-07 に規定が無いため追加しない**
  (必要なら別途仕様追加を提案する。実装側は定数で音量を持つ)
- **P1 タブ(PracticeDebug.tsx)は対象外**。判定エンジン単体の確認用の画面であり、
  練習に使う画面ではないため(挙動の不揃いは意図的)

## ディレクトリ構成(追加・変更分)

```
src/
  audio/
    audioContext.ts   # AudioContext を 1 個だけ持つ共有モジュール(F-08: 起動時に1度だけ生成)
    referenceTone.ts  # 参照音の生成(倍音 + ADSR)。ポリフォニック対応。シングルトンを export
    feedback.ts       # (変更)共有 AudioContext を使う。close() は Context を閉じない
  core/
    constants.ts      # (追記)参照音のパラメータ(音量・ADSR・倍音構成・最大発音時間)
  components/
    PracticeScreen.tsx    # (変更)Note On で参照音 → その後に判定。Note Off で減衰
    CalibrationDebug.tsx  # (変更)同上
  App.tsx               # (変更)起動時の AudioContext 生成と、初回操作での resume 解除
tests/
  audio/
    referenceTone.test.ts  # 周波数計算など純関数のテスト
```

## 実装内容

### 1. `audio/audioContext.ts`(共有 AudioContext)

**F-08「アプリ起動時に 1 度だけ生成」に忠実に、生成と resume を分離する**(レビュー指摘: 高):

- **生成はモジュール初期化時(アプリ起動時)に 1 度だけ**。
  `new AudioContext({ latencyHint: "interactive" })` は自動再生ポリシー下でも例外を投げず、
  `state: "suspended"` で作られるだけ。**禁止されているのは「音を出すこと」であって「生成」ではない**
  - 遅延生成にすると、最初の Note On ハンドラ内で数〜数十 ms のグラフ初期化が走り、
    F-08 が最小化したいはずの「最初の一音の遅延」が最大になる
- `resumeAudio()`: `state !== "running"` なら `resume()` を呼ぶ(**Promise は await しない**。
  Note On の処理をブロックしないため)
- `isAudioRunning()`: 画面に「音を有効にするには画面を一度タップしてください」を出す判定に使う
- **一度作った Context は閉じない**。万一 `state === "closed"` なら作り直すフォールバックを入れる
- `getAudioLatency()`: `baseLatency` / `outputLatency` を返す(デバッグ表示用。10 章の遅延の実測)

### 2. `App.tsx`: 音の有効化(レビュー指摘: 高 — F-08 の主目的に直結)

**MIDI メッセージの受信はユーザー操作として扱われない**ため、ページを開いて一度も画面を触らずに
実鍵盤を弾くと、AudioContext が `suspended` のままで**無音になる**。対策:

- App で `pointerdown` / `keydown` の `{ once: true }` リスナを張り、`resumeAudio()` を呼ぶ
- `state !== "running"` の間は画面上部に
  **「🔇 音を出すには画面を一度タップしてください」**のバナーを表示(Android 実機で特に効く)

### 3. `audio/referenceTone.ts`(参照音)

**周波数計算(純関数・テスト対象)**

```ts
midiToFrequency(midi: number): number   // A4(69) = 440Hz 基準。440 * 2^((midi-69)/12)
```

**発音(`ReferenceTone` クラス。`audio/` 側でシングルトンを持ち `getReferenceTone()` で取る)**

- **マスターゲイン**を 1 個だけ持ち、全 voice をそこに通す(レビュー指摘: 中)
  - ポリフォニック(和音)+ 既存ビープの合算でクリップしないよう、1 音あたりの振幅は 0.1〜0.15 程度
  - `DynamicsCompressorNode` を 1 個挟む(Web Audio 標準ノードなので 5 章に抵触しない)
- `noteOn(midi)`:
  - **倍音を数本重ねる**(F-08): 基音 + 第2・第3倍音の `OscillatorNode` を重ね、上の倍音ほど小さく
  - **ADSR**(F-08: 速いアタック・緩やかな減衰): Attack 数 ms → `setTargetAtTime` で緩やかに減衰
  - **必ず `osc.stop()` を予約する**(レビュー指摘: 高)。
    `setTargetAtTime` は数学的にゼロへ到達しないため、stop を予約しないと
    オシレータが永遠に走り続け `onended` も発火せず**ノードが溜まり続ける**。
    リリース終端で `linearRampToValueAtTime(0, stopTime)` を重ねて確実に 0 にし、プチノイズも防ぐ
  - **最大発音時間**(`REFERENCE_TONE_MAX_SECONDS = 8`)を必ず予約する。
    Note Off が来なくても必ず止まる最後の砦(下記スタックノート対策)
  - **ポリフォニック管理**: `Map<midi, voice>`。ただし **Map は押下中の voice だけを持つ**。
    Note Off / 連打による再打鍵の時点で**まず Map から外し**、外れた voice はリリースして自走で消える
    (連打の余韻が自然に重なり、ピアノらしくもなる)
  - **同音連打の Map レース対策**(レビュー指摘: 高): 破棄時は
    `if (voices.get(midi) === voice) voices.delete(midi)` と**同一性チェック**を入れる。
    これをしないと古い voice の `onended` が新しい voice のエントリを消し、
    以降その音は Note Off が効かず鳴りっぱなしになる(仕様 7.1 の同音連打で確実に踏む)
  - 連打で前の音を止めるときは gain を即 0 にせず、5〜10ms の `linearRampToValueAtTime` で落とす
    (即 0 は必ずプチッと鳴る)
- `noteOff(midi)`: Map から外してリリース開始
- `stopAll()`: 全部止める

**パラメータは `core/constants.ts` に集約**し、**単位をサフィックスに明記**
(`REFERENCE_ATTACK_MS` など。既存の `MIDI_TIMESTAMP_SANITY_MS` の流儀に揃える)。
リリースは短すぎるとスタッカートがブツ切れになるため **150〜300ms** を初期値にする。
音量は `FEEDBACK_VOLUME` を流用せず **`REFERENCE_TONE_VOLUME` を別途定義**。

### 4. スタックノート(鳴りっぱなし)対策(レビュー指摘: 高)

既存コードには **Note Off が永久に来ない経路が 4 つ**あり、音が出た瞬間に顕在化する:

1. **PC キー押下中のフォーカス喪失**(Alt+Tab で `keyup` が届かない)
2. **押下中のオクターブシフト**(鍵盤 div がアンマウントされ `onPointerUp` が飛ばない)
3. **実デバイスの抜線**(`input.disconnect()` 後に Note Off が来ない)
4. **タブ切替**(リスナ解除で Note Off を取りこぼす)

対策:
- **最大発音時間の予約**(上記 §3。最後の砦)
- `window` の `blur` と `document` の `visibilitychange`(hidden)で `stopAll()`
- 画面のアンマウント時に `stopAll()`

### 5. `audio/feedback.ts` の変更(レビュー指摘: 中 — 回帰として最も致命的)

- 自前の AudioContext 生成をやめ、**共有 `getAudioContext()` を使う**
- **`close()` が共有 Context を閉じないようにする**。
  現在 `PracticeScreen.tsx` の useEffect が**アンマウント時に `feedback.close()` を呼んでおり**、
  そのままだと **P4 タブから他タブへ移った瞬間に共有 Context が閉じ、
  閉じた Context は resume できないためアプリ全体が以後無音になる**
  - `FeedbackSound.close()` は中身を空にし、JSDoc に理由を明記(または削除)
  - `PracticeScreen.tsx` の当該 useEffect を **`referenceTone.stopAll()` に置き換え**、コメントも更新
- **参照音を `settings.feedbackEnabled` / `feedbackVolume` に紐づけない**。
  紐づけると「フィードバック音 OFF」で参照音まで消え、F-08 の「Note On 時に即座に再生」に反する

### 6. 画面への組み込み(PracticeScreen / CalibrationDebug)

- **参照音の発音は、ハンドラ冒頭の早期 return より前に置く**(レビュー指摘: 中)。
  `PracticeScreen.tsx` の Note On ハンドラは冒頭に
  `if (pausedRef.current || showResultRef.current) return;` と `if (judge.isFinished()) return;` があり、
  この**下**に置くと一時停止中に音が鳴らなくなる(F-08 と §7 の判断に反する)
- **Note Off も購読**して `referenceTone.noteOff(midi)` を呼ぶ。
  バーチャル鍵盤・実デバイスの**両方**を購読し、**cleanup で 4 本すべて解除**する(解除漏れ注意)
- 画面離脱時に `stopAll()`

### 7. 一時停止中・結果表示中も参照音は鳴らす

F-08 は発音条件に練習状態の但し書きを置かず「実際のピアノと同じ挙動」と明記している。
一時停止(F-05)は「判定を止める」機能であって「楽器を黙らせる」機能ではない。
判定側は従来どおり早期 return でスキップするので判定ログの純度は保たれる。

### 8. テスト(`tests/audio/referenceTone.test.ts`)

Web Audio API は Node にないため、**純関数 `midiToFrequency` のみ**をテストする。

- A4(69)= 440Hz / A3(57)= 220Hz / A5(81)= 880Hz(オクターブ関係)
- 中央ド C4(60)≒ 261.63Hz
- 半音上(61)が 2^(1/12) 倍

## 実装手順(作業単位ごとに commit)

1. 本計画を commit
2. `audioContext.ts` + `referenceTone.ts` + 定数 + テスト → `npm run test` → commit
3. `feedback.ts` を共有 Context に移行 + **PracticeScreen の close() 呼び出しを修正** → commit
4. 画面への組み込み(発音を早期 return より前に / Note Off 購読)+ App の resume 解除 → ブラウザ確認 → commit
5. README / CLAUDE.md 進捗ログ更新 → commit

## 完了条件と検証

- `npm run test` 全件パス / `npm run build` 成功
- ブラウザ:
  1. バーチャル鍵盤を押すと**その音の高さで音が鳴る**(ドとソで音の高さが違う)
  2. 押している間鳴り、離すと止まる
  3. 和音(複数同時)が鳴る / **5〜10 音同時 + ビープ同時でも歪まない**
  4. **同じ音を数十回高速連打しても鳴り続け、ノード数が単調増加しない**
  5. 判定(正解/音ミスの表示)がこれまで通り動く
  6. **鍵盤を押しっぱなしでタブ切替 → 音が残らない**
  7. **鍵盤を押しっぱなしでオクターブシフト → 音が残らない**
  8. **P4 タブ → 他タブ → P4 タブと移動しても音が出続ける**(共有 Context を閉じていないこと)
- 実機(開発者に依頼):
  - MIDI キーボードを弾いて音が鳴り、遅延が気にならないこと
  - **ページ読込直後に画面を一度もクリックせず実鍵盤を弾く → 音が出るか**
    (出ない場合はバナーの案内で解除できること)
  - 演奏中に USB を抜く → 鳴りっぱなしにならない

## 技術的な注意点

- **AudioContext は 1 個だけ**。ブラウザは同時に作れる AudioContext 数に制限(Chrome は概ね 6)がある
- `OscillatorNode` は**使い捨て**(一度 stop したら再利用不可)。Note On ごとに作る
- ゲインの急変はプチノイズになるため、必ずランプでつなぐ
- `setTargetAtTime` は指数減衰でピアノらしいが、**ゼロに到達しないので stop() の予約が必須**
- 音が鳴り終わったノードは `onended` で `disconnect()` する
- `ctx.baseLatency` / `outputLatency` をデバッグ表示に出す(Windows では数十 ms 乗ることがあり、
  卒論の記述材料にもなる)
