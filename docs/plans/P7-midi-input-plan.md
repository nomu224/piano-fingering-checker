# 実 MIDI デバイス入力の実装計画(F-01 の MIDI 部分 / 残件消化)

## 背景・目的

P1〜P6 は MIDI キーボード未入手のため、バーチャル MIDI(F-02)のみで開発してきた。
2026-07-15 に開発者が実キーボードを USB ケーブルで PC に接続したため、
**仕様書 F-01 の「MIDI 入力デバイスの一覧表示・選択」を実装する**(これまでの唯一の未実装機能)。

完了条件: **実キーボードを選択して弾くと、バーチャル鍵盤と同じように音判定・運指判定が動く**。

## 仕様書の該当章

- F-01: 「MIDI 入力デバイスの一覧表示・選択(未接続時は『バーチャル MIDI』を選択可能)」
  「権限リクエストの誘導(カメラ / MIDI とも)」
- 3.1: 特定機種に依存しない実装。Web MIDI API で見える任意の MIDI 入力デバイスを選択できる UI。
  **「キーボードが一覧に出ない場合は OS の Bluetooth 設定でペアリングを確認」というガイド文を表示**
  Bluetooth のペアリングは OS 側で行うため、**アプリ側に Bluetooth 固有の実装は不要**
- 5 章: **Web MIDI API を標準 API として直接使用(ラッパーライブラリ禁止)**
- F-02: 「実 MIDI デバイスと同じインターフェースで判定エンジンに渡す(判定エンジン側は入力源を区別しない)」
- 10 章: 権限拒否時に分かりやすいエラーと再試行導線

## やらないこと

- Bluetooth ペアリング機能(仕様 3.1 で明確に OS 側の役割)
- 外部ライブラリの追加(仕様 5 章でラッパー禁止。**新規依存はゼロ**)
- 正式なセットアップ画面 S-01 への再構成(現状の開発用タブ構成を維持)
- MIDI 出力(このアプリは入力のみ)

## ディレクトリ構成(追加・変更分)

```
src/
  midi/
    midiInput.ts        # Web MIDI API ラッパー(MidiSource 実装)+ メッセージ解析(純関数)
  components/
    MidiDeviceSelector.tsx  # デバイス選択 UI + ガイド文 + 再試行(F-01)
    useMidiDevices.ts       # MIDIAccess の取得・デバイス一覧・接続管理のフック
    PracticeScreen.tsx      # (変更)実 MIDI とバーチャル鍵盤の両方を購読
    CalibrationDebug.tsx    # (変更)同上(キャリブレーションも実機で行えるように)
tests/
  midi/
    midiInput.test.ts   # MIDI メッセージ解析の純関数テスト
```

## 実装内容

### 1. `midi/midiInput.ts`

冒頭コメントに「**外部ライブラリは使わず Web MIDI 標準 API を直接使用**」と明記する
(仕様 13 章のファイル名は `midiInput.ts # Web MIDI ラッパー` だが、5 章の「ラッパーライブラリ不要」= 外部依存禁止の意)。

**(a) メッセージ解析(純関数・テスト対象)**

```ts
parseMidiMessage(data: Uint8Array | null | undefined): { type: "noteOn" | "noteOff"; note: number; velocity: number } | null
```

- **`MIDIMessageEvent.data` は DOM 型定義上 `Uint8Array | null`** なので、null 許容で受けて null を返す
  (strict モードのため、非 null 前提だとコンパイルエラーになる)
- 解析対象は**先頭 3 バイトのみ**

- ステータスバイトの上位 4bit で判定し、**チャンネル(下位 4bit)は問わない**(全チャンネル受け付け)
  - `0x9n` = Note On。ただし **velocity 0 は Note Off として扱う**(MIDI の慣習。多くの鍵盤がこの形式で離鍵を送る)
  - `0x8n` = Note Off
- それ以外(コントロールチェンジ、ピッチベンド、アクティブセンシング 0xFE など)は `null` を返して無視
  - ※ 一部のキーボードは 0xFE を数百 ms 間隔で送り続けるため、無視の徹底が必要
- データ長が足りないメッセージも `null`

**(b) `MidiDeviceInput implements MidiSource`(クラス)**

- `MidiSource` インターフェース(既存)を実装するので、**判定エンジン・画面側の判定ロジックは無変更**
- **インスタンスは `useRef` で 1 個だけ作り**、`connect()` / `disconnect()` で内側の `MIDIInput` を差し替える
  (参照が変わるとリスナー登録が壊れるため)
- `connect(input: MIDIInput)`: 指定デバイスの `onmidimessage` を購読。既存の購読は解除してから差し替える
- `disconnect()`: 購読解除

**タイムスタンプの扱い(仕様 7.2 の精度に直結。実機導入で初めて本番稼働する経路)**

`MIDIMessageEvent.timeStamp` は `Event.timeStamp` = time origin 基準の DOMHighResTimeStamp で、
`performance.now()` と同一基準(既存の handTracker / useHandCamera も同基準で統一済み)。

ただし `landmarkHistory.getNearestFrame()` には**距離の閾値が無く、どんなに離れた時刻でも
必ず最も近いフレームを返す**ため、異常な値(epoch 基準の巨大値など)が入ると
常に最古フレームを掴んで**エラーも出さずに指特定が誤り続ける**(評価データが汚染される最悪のパターン)。

そこでサニティチェックを入れる:

```
const now = performance.now();
const raw = event.timeStamp;
const ts = Number.isFinite(raw) && raw > 0 && Math.abs(raw - now) < MIDI_TIMESTAMP_SANITY_MS
  ? raw : now;   // 異常なら現在時刻にフォールバック
```

- `MIDI_TIMESTAMP_SANITY_MS` は **`src/core/constants.ts` に定義**し、単位をコメントで明記(LESSONS.md の教訓 3)
- 値は 1000(ms)。履歴は 5 フレーム(20〜30fps で 170〜250ms 相当)なので十分に余裕がある
- **`timeStamp - performance.now()` の実測差をデバッグ表示**する(LESSONS.md の教訓 1「見える化して実物と見比べる」)。
  USB と BLE の遅延差(仕様 12 章「+10〜20ms」)の実測は卒論の考察材料にもなる

### 2. `components/useMidiDevices.ts`(フック)

**呼び出し場所**: **`App.tsx` でこのフックを呼び、props で練習画面・キャリブレーション画面へ渡す**。
理由: App.tsx はタブを条件レンダリングしており、画面内でフックを呼ぶとタブ切替で選択が失われる。
さらに PracticeScreen はキャリブレーション有無で別コンポーネントに分岐するため、
**キャリブレーション完了直後(一番使いたい瞬間)に再マウントされて選択が消える**。
`calibrationInfo` / `settings` と同じ「App が保持して配る」既存パターンに揃える。

- `navigator.requestMIDIAccess({ sysex: false })` は**常にユーザー操作(ボタン押下)を起点に**呼ぶ
  - **自動接続はしない**(仕様は要求していない。唐突に権限プロンプトを出さない設計意図と一貫)
- 状態: `unsupported`(Web MIDI 非対応ブラウザ)/ `idle`(未接続)/ `granted` / `denied` / `error`
- デバイス一覧: **`access.inputs` は DOM 型定義上 `forEach` しか持たないため `forEach` で配列に詰める**
  (`values()` / `get()` / `size` は型定義に無く、`npm run dev` では動くのに `npm run build` で落ちる)
  - `state === "connected"` のポートのみ一覧に出す(disconnected が残ることがある)
  - 表示名は `port.name ?? port.manufacturer ?? port.id`(`name` は `string | null`)
- `access.onstatechange` で**抜き差しに追従**:
  - **抜いても `selectedId` は保持し、「切断中(再接続待ち)」と表示**する
  - 挿し直すと同じ id で自動的に再オープンされ受信が再開する(選択し直し不要)
- 返り値: `{ status, devices, selectedId, selectDevice, requestAccess, error, midiInput, isSelectedConnected }`

### 3. `components/MidiDeviceSelector.tsx`(F-01 の UI)

- 「MIDI 機器」ドロップダウン:「バーチャル鍵盤(画面)」+ 検出された実デバイス名
  - 仕様 F-01「未接続時は『バーチャル MIDI』を選択可能」を満たす。**既定はバーチャル**(現状の動作を壊さない)
- 未許可のときは「MIDI 機器に接続」ボタン → `requestAccess()`
- ガイド文(仕様 3.1 をそのまま反映):
  - 「キーボードが一覧に出ない場合は、OS の Bluetooth 設定でペアリングを確認してください」
  - 「Windows では Bluetooth 接続が不安定な場合があるため、USB ケーブル接続を推奨します」
- 権限拒否・非対応時のエラー表示と再試行ボタン(仕様 10 章)。
  **エラーの振り分けは既存の `useHandCamera.ts` の `toErrorMessage()` に倣って `toMidiErrorMessage()` を作る**:
  - `unsupported`: `typeof navigator.requestMIDIAccess !== "function"`(非対応ブラウザ / 非セキュアコンテキスト)
  - reject 時は `err.name` で分岐 — `SecurityError` / `NotAllowedError` → `denied`、
    `NotSupportedError` → `unsupported`、その他 → `error`
  - 非対応(iOS Safari 等)の場合は「この端末では実 MIDI が使えません。バーチャル鍵盤をお使いください」

### 4. 画面への組み込み(PracticeScreen / CalibrationDebug)

- 両画面で `MidiDeviceSelector` を表示し、**実 MIDI とバーチャル鍵盤の両方の Note On を購読**する
  - 実機を選んでいてもバーチャル鍵盤は動いたままにする(片手が塞がるテストや、実機不調時の代替になるため)
  - 判定エンジン側の処理は**完全に共通**(F-02「入力源を区別しない」)
- 既存の `keyboard.addNoteOnListener(...)` の隣に `midiInput.addNoteOnListener(同じハンドラ)` を追加するだけ
- **鍵盤 UI の押下ハイライトはバーチャルのみに繋ぐ**(`VirtualKeyboard.tsx` の表示状態管理に実機を繋ぐと、
  表示範囲 2 オクターブ外の音や Note Off の取りこぼしで表示が壊れる)
- 実機側には `VirtualMidiKeyboard` のような多重 Note On 抑止を**入れない**
  (実機は必ず Note Off を挟む。抑止すると仕様 7.1 の同音連打が動かなくなる)

### 5. テスト(`tests/midi/midiInput.test.ts`)

- Note On(0x90 60 100)→ noteOn / note=60
- **velocity 0 の Note On(0x90 60 0)→ noteOff として扱う**
- velocity 1(最小値)は noteOn(velocity 0 との境界)
- Note Off(0x80 60 64)→ noteOff
- **チャンネル違い(0x95 / 0x83)も同様に解釈される**
- コントロールチェンジ(0xB0)・ピッチベンド(0xE0)・**アクティブセンシング(0xFE)**・
  **MIDI Clock(0xF8)/ Start(0xFA)** → null(無視)
- データ長不足 → null
- **`null` / `undefined` → null**

テストは `parseMidiMessage` のみ import する(DOM 型に触れずに済む)。

## 実装手順(作業単位ごとに commit)

1. 本計画を commit
2. `midiInput.ts` + テスト → `npm run test` → commit
3. `useMidiDevices.ts` + `MidiDeviceSelector.tsx` → commit
4. 練習画面・キャリブレーション画面への組み込み → ブラウザ確認 → commit
5. README / docs/android-check.md / CLAUDE.md 進捗ログ更新 → commit

## 完了条件と検証

- `npm run test` 全件パス(既存 83 件 + MIDI 解析の新規テスト)
- `npm run build` 成功
- ブラウザ(開発者に依頼):
  1. 「MIDI 機器に接続」→ Chrome の許可プロンプトで許可 → 一覧にキーボード名が出る
  2. キーボードを選んで実際に弾くと、練習画面の判定が動く(正しい音=正解、違う音=ビープ B)
  3. カメラありなら運指判定も動く(違う指=ビープ A)
  4. USB を抜くと一覧から消え、挿すと再び現れる(statechange 追従)
  5. バーチャル鍵盤も同時に使える

## 技術的な注意点

- **Web MIDI API は Chrome/Edge のみ**(Firefox は限定的、Safari 非対応)。非対応時の案内を必ず出す
- **セキュアコンテキスト必須**: localhost は OK、公開版も HTTPS なので問題なし
- Chrome の MIDI 権限は sysex なしなら比較的緩いが、プロンプトが出る場合がある
- `navigator.requestMIDIAccess` の型は TypeScript 標準の DOM 型に含まれる(追加の型定義パッケージ不要)
- **`MIDIInputMap` の DOM 型定義は `forEach` のみ**。`values()` / `get()` / `size` を使うと
  実行時は動くのに `npm run build`(tsc)で落ちる。型を騙すキャストはせず `forEach` で扱う
- **`MIDIMessageEvent.data` は `Uint8Array | null`**。null 許容で受ける
- **デバイス選択は localStorage に保存しない**(仕様に規定なし。キャリブレーションを保存しない F-03 の思想と一貫)
