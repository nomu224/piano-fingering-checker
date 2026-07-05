# P2 実装計画: カメラ + MediaPipe Hands + ランドマーク描画 + リングバッファ

## 目的

仕様書 11 章 P2「MediaPipe Hands 組み込み + カメラプレビュー + ランドマーク描画」を実装する。
完了条件: **Web カメラで両手 21 点が安定して描画される**。

## 仕様書の該当章

- 7.2(入力部分): 21 点ランドマーク × 最大 2 手(handedness 付き)/ **ランドマーク履歴のリングバッファ(重要注記: 直近 5 フレーム程度、Note On のタイムスタンプに最も近いフレームを使う)** / handedness の反転読み替え注意
- F-01(カメラ部分): カメラの選択・プレビュー / **左右反転(ミラー)切替(デフォルト反転なし。内部座標は常に生映像基準、プレビュー表示だけ反転)** / 権限リクエストの誘導
- 5 章: MediaPipe Hands は `@mediapipe/tasks-vision` の HandLandmarker、numHands: 2、GPU delegate 優先
- 10 章: カメラ映像は端末外に一切送信しない(この旨を画面に明記)/ 権限拒否時の分かりやすいエラーと再試行導線
- 12 章: 認識状態(手が見えているか)のリアルタイム表示

## P2 でやらないこと

- 判定エンジンとの接続(ユーザー指示で明示的に対象外。P3〜P4)
- キャリブレーション(F-03、P3)
- 「カメラなしで開始」ボタンの本実装・正式なセットアップ画面 S-01(後続フェーズ。P2 はデバッグ用の確認画面まで)
- 解像度を下げる設定 UI(12 章。設定画面のある P5 で対応)

## 外部ライブラリの追加

`@mediapipe/tasks-vision` を dependencies に追加する。**仕様書 5 章が明示指定しているライブラリ**であり、追加理由は仕様そのもの。
WASM ランタイムと手認識モデル(`hand_landmarker.task`、約 7.5MB)は CDN に依存せず `public/mediapipe/` に同梱する
(理由: 10 章のプライバシー方針と P6 の PWA 化・GitHub Pages 配信を見据えてすべて自前配信にする)。

## ディレクトリ構成(仕様書 13 章に準拠、P2 で追加する分)

```
public/
  mediapipe/
    wasm/                  # @mediapipe/tasks-vision の WASM ランタイム(node_modules からコピー)
    hand_landmarker.task   # 手認識モデル(Google 公式配布物をダウンロード)
src/
  core/
    types.ts               # (追記)ランドマーク・検出フレームの型(純データ型。P3 の指特定の入力になる)
    constants.ts           # (追記)リングバッファサイズ / handedness 読み替えフラグ
  vision/
    landmarkHistory.ts     # リングバッファ(純 TS・ブラウザ API 非依存 → ユニットテスト対象)
    handTracker.ts         # MediaPipe HandLandmarker ラッパー(初期化・毎フレーム検出・履歴への記録)
  components/
    CameraDebug.tsx        # P2 動作確認画面(カメラ選択・プレビュー・ランドマーク描画・ミラー切替)
tests/
  core/                    # 既存
  vision/
    landmarkHistory.test.ts
```

- 仕様書 13 章では「handTracker.ts = MediaPipe ラッパー + リングバッファ」だが、リングバッファは
  ブラウザ API 非依存の純 TS としてテストしたいため `landmarkHistory.ts` に分離する(handTracker が内包して使う)。
  役割の分離のみで機能の逸脱はない。

## 実装内容

### 1. 型と定数(src/core/ へ追記)

- `HandLandmark`(x, y, z: 正規化座標)/ `DetectedHand`(handedness: "Left" | "Right"、score、21 点の landmarks)/
  `LandmarkFrame`(timestampMs、hands: DetectedHand[])を `core/types.ts` に追加。
  純データ型であり、P3 で指特定(core)の入力になるため core に置く
- `constants.ts` に追加(いずれも「実験で調整するパラメータ」コメント付き):
  - `LANDMARK_HISTORY_SIZE = 5`(7.2: 直近 5 フレーム程度)
  - `SWAP_HANDEDNESS = false`(7.2 注意書き: handedness の読み替えの有無を 1 箇所の定数で切替。実映像で検証して決める)

### 2. リングバッファ `vision/landmarkHistory.ts`(ユニットテスト対象)

- 固定長(LANDMARK_HISTORY_SIZE)のリングバッファに `LandmarkFrame` を push
- `getNearestFrame(timestampMs)`: 保持フレームからタイムスタンプが最も近いものを返す(7.2 の重要注記。P3 で Note On との突き合わせに使う)
- 空のときは null。テスト: 上書き(古いフレームが消える)/ 最近傍選択(前後どちらが近いか)/ 空

### 3. MediaPipe ラッパー `vision/handTracker.ts`

- `FilesetResolver.forVisionTasks("<BASE_URL>mediapipe/wasm")` + `HandLandmarker.createFromOptions`
  - `numHands: 2`、`runningMode: "VIDEO"`、`delegate: "GPU"` を試し、失敗したら CPU にフォールバック(5 章「GPU delegate 優先」)
- `detect(video, timestampMs)`: `detectForVideo` を呼び、結果を `LandmarkFrame` に変換して履歴リングバッファに記録して返す
  - **タイムスタンプは `performance.now()` 基準に統一**(`src/midi/types.ts` の `NoteMessage.timestampMs` と同一時計。
    P3 で `getNearestFrame(NoteOnの時刻)` が正しく機能するための必須条件)。`detectForVideo` に渡す値も同じもの(単調増加)
  - handedness は `SWAP_HANDEDNESS` 定数を通して "Left"/"Right" に正規化(生映像基準で統一)
- 検出ループはコンポーネント側で `requestAnimationFrame` により回す(fps が落ちても Note On 駆動の判定は破綻しない設計 = 10 章)

### 4. カメラ確認画面 `components/CameraDebug.tsx`

- カメラ選択: `navigator.mediaDevices.enumerateDevices()` で videoinput 一覧 → `getUserMedia({ video: { deviceId } })`。
  権限取得前はラベルが空になるため、まず既定カメラで権限を取ってから一覧を更新する
- プレビュー: `<video>` + 重ねた `<canvas>` にランドマーク 21 点と骨格線を描画(左右の手で色分け)
- **ミラー切替**: チェックボックス。**初期値は OFF(=反転なし。F-01 が明示指定するデフォルト)**。
  ON のとき video と canvas に CSS `transform: scaleX(-1)` を適用するだけ。
  **描画座標・handedness などの内部処理は常に生映像基準**(F-01 の指定どおり座標系に反転を持ち込まない)
- カメラ切替時は旧 `MediaStream` の全トラックを `stop()` してから新デバイスを取得する(LED 点きっぱなし・取得失敗の防止)
- 認識状態の表示: 検出中の手の数(右手/左手)と処理 fps を表示(12 章の対策 + 完了条件「安定して描画」の確認用)
- 権限拒否・カメラなしのときは日本語のエラーメッセージ + 再試行ボタン(10 章)
- 「カメラ映像は端末の外に送信されません(すべてブラウザ内で処理)」の明記(10 章)
- App.tsx に画面切替(P1 動作確認 / P2 カメラ確認)の仮タブを付ける(正式な画面遷移は後続フェーズ)

### 5. アセット配置

- `node_modules/@mediapipe/tasks-vision/wasm` → `public/mediapipe/wasm` にコピー
- `hand_landmarker.task`(float16/latest)を Google 公式 URL からダウンロードして `public/mediapipe/` に配置
- モデルの読み込みは `import.meta.env.BASE_URL` 基準(P6 の GitHub Pages サブパス配信を壊さないため)

## 実装手順(作業単位ごとに commit)

1. 本計画を commit
2. `@mediapipe/tasks-vision` 追加 + wasm/モデルを public/ に配置 → commit
3. 型・定数の追記 + `landmarkHistory.ts` + ユニットテスト → `npm run test` 確認 → commit
4. `handTracker.ts` → commit
5. `CameraDebug.tsx` + App の仮タブ → ブラウザ動作確認 → commit
6. README(P2 の動作確認手順 + MediaPipe 同梱物の出典・Apache-2.0 ライセンス表記)+ CLAUDE.md 進捗ログ → commit

## 完了条件と検証

- `npm run test` 全件パス(既存 19 件 + リングバッファのテスト)
- `npm run build` が通る
- `npm run dev` でカメラ確認画面を開き:
  1. カメラ権限を許可するとプレビューが表示される
  2. 両手をかざすと 21 点 × 2 手のランドマークが手に追従して描画される(左右で色が違う)
  3. 検出中の手の数と fps が表示され、PC で 20fps 以上出ている(10 章)
  4. ミラー切替を ON にすると表示だけ左右反転する(handedness 表示は変わらない)
  5. 権限を拒否するとエラーメッセージと再試行ボタンが出る
- ※ 開発 PC に Web カメラがない場合はスマホの Web カメラ化アプリで代替(仕様書 1.3)

## 仕様上の解釈・判断(レビュー観点)

- WASM・モデルの同梱(CDN 不使用)は「カメラ映像を送信しない」方針の直接の要請ではないが、P6 のオフライン PWA・自前配信と整合する安全側の判断
- handedness の実映像検証(7.2 注意書き)は Web カメラのある環境でしか確定できないため、P2 では定数 `SWAP_HANDEDNESS` と
  画面表示(どちらの手として認識されたか)まで用意し、**ユーザーに実カメラでの確認を依頼**する。値の確定は P3 のキャリブレーション実装時までに行う
