# P3 実装計画: キャリブレーション(F-03) + 指特定(7.2)

## 目的

仕様書 11 章 P3「キャリブレーション + 指特定ロジック」を実装する。
完了条件: **実カメラ + バーチャル MIDI(または実キーボード)で、押した指が推定・表示される**。

## 仕様書の該当章

- F-03: キャリブレーションウィザード(手順 1〜5)、結果はメモリ内保持のみ、カメラ・反転変更で再キャリブレーション必須
- 7.2: 指特定の推定ロジック 1〜5(hand 一致の手のみ / 指先 5 点の x 距離 / 信頼度閾値と判定不能 / 閾値は定数ファイルに集約)
- 7.2 重要注記: Note On のタイムスタンプに最も近いフレームを使う(P2 のリングバッファを使用)
- ユーザー指示: デバッグ表示「Note On ごとに推定した指番号と信頼度を画面に出す」/ バーチャル MIDI でも動作確認できること

## P3 でやらないこと

- 運指判定(推定指と譜面指番号の比較。7.3 → P4)。スコアフォローとの接続も P4
- ビープ音(P4)、設定画面での「判定の厳しさ」(F-07 → P5)
- 拡張余地(Note On 直前の指先 y 速度、カメラ遅延補正)は仕様書の指示どおり実装せず TODO コメントのみ

## ディレクトリ構成(追加・変更分)

```
src/
  core/
    types.ts            # (追記)KeyboardCalibration / FingerEstimateResult 型
    constants.ts        # (追記)指特定・キャリブレーションの閾値(実験で調整するパラメータ)
    fingerEstimator.ts  # 指特定ロジック(7.2 推定ロジック1〜5。純TS・テスト対象)
  vision/
    calibration.ts      # キャリブレーション計算(基準2点→線形補間、最下指先の抽出、ズレ計算。純TS・テスト対象)
  components/
    useHandCamera.ts    # カメラ+HandTracker の共通フック(CameraDebug から抽出するリファクタリング)
    CameraDebug.tsx     # (変更)useHandCamera を使うように整理(見た目・機能は不変)
    CalibrationDebug.tsx # P3 動作確認画面(ウィザード + 指特定デバッグ表示 + バーチャル鍵盤)
  App.tsx               # (変更)タブ「P3: キャリブレーション・指特定」を追加
tests/
  core/fingerEstimator.test.ts
  vision/calibration.test.ts
```

- 13 章では calibration.ts は vision/ 配下。純粋な計算(座標変換・補間)として実装しユニットテスト対象にする
- `KeyboardCalibration` 型と「ノート番号→x 座標」「半音間隔幅」の変換関数は core に置く
  (fingerEstimator の入力であり、core→vision の依存を作らないため。vision/calibration.ts はそれを利用する側)

## 実装内容

### 1. 型(core/types.ts に追記)

```ts
/** キャリブレーション結果: 基準2点による線形補間(F-03 手順4) */
interface KeyboardCalibration {
  lowMidi: number;  lowX: number;   // 低い方の基準鍵盤(x は正規化座標)
  highMidi: number; highX: number;  // 高い方の基準鍵盤
}

/** 指特定の結果(7.2) */
type FingerEstimateResult =
  | { status: "estimated"; finger: 1..5; distanceSemitones: number;  // 最小距離(半音間隔比)
      marginSemitones: number;  // 1位と2位の差(信頼度の根拠)
      usedYTieBreak: boolean }  // y 座標による拮抗解消を使ったか
  | { status: "undetermined"; reason: "handNotDetected" | "tooFar" | "ambiguous" };
```

- 「信頼度」の表示は distanceSemitones / marginSemitones の具体値を出す(7.2 の閾値と同じ単位=半音間隔比なので解釈しやすい)

### 2. 定数(core/constants.ts に追記。すべて「実験で調整するパラメータ」コメント付き)

- `FINGER_MAX_DISTANCE_SEMITONES = 0.6`(7.2: これを超えたら判定不能)
- `FINGER_AMBIGUOUS_MARGIN_SEMITONES = 0.25`(7.2: 1位2位の差がこれ未満なら拮抗 → y 座標で判定)
- `FINGER_Y_TIEBREAK_MIN_DIFF = 0.02`(7.2: y 差が画像高さの 2% 未満なら判定不能。正規化座標なので 0.02)
- `CALIBRATION_MAX_DEVIATION_SEMITONES = 0.5`(F-03 手順5: これを超える打鍵が1回でもあれば再キャリブレーション促し)
- `CALIBRATION_RECOMMENDED_REF_DISTANCE = 12`(F-03 手順2: 基準2鍵は1オクターブ以上離すガイド)

### 3. 指特定 `core/fingerEstimator.ts`(7.2 の推定ロジック 1〜5 を忠実に)

```
estimateFinger(frame, hand, midi, calibration) → FingerEstimateResult
```

1. `midi` から鍵盤の x 座標 `kx` を得る(`noteToX(calibration, midi)`)
2. `frame.hands` から `hand` に一致する手だけを対象(同じ handedness が複数検出された場合は score 最大を採用)。無ければ `handNotDetected`
3. 指先ランドマーク 4, 8, 12, 16, 20 の `|x - kx|` を半音間隔比で計算(半音幅は `|highX-lowX| / (highMidi-lowMidi)`。**カメラの向きにより幅が負になる配置でも動くよう絶対値を使う**)
4. 最小距離の指先を採用。指番号: 親指=1〜小指=5
5. 信頼度:
   - 最小距離 > 0.6 → `tooFar`
   - 1位と2位の差 < 0.25 → y 座標比較(**y が大きい=画像の下=鍵盤に近い方**を採用)。y 差 < 0.02 → `ambiguous`
- frame が null(履歴なし)の場合も `handNotDetected` 相当の判定不能
- TODO コメント: 指先 y 速度(下降検出)、カメラ遅延補正(7.2 の拡張余地)

### 4. キャリブレーション計算 `vision/calibration.ts`(純TS)

- `findLowestFingertip(frame)`: 全検出手の全指先(4,8,12,16,20)から **y が最大(=画像の最も下=鍵盤側)** の指先を返す(F-03 手順2の「最も下にある指先」)。手が無ければ null
- `buildCalibration(low, high)`: 基準2点から KeyboardCalibration を作る。同一ノートはエラー(補間不能)
- `deviationSemitones(calibration, midi, fingertipX)`: 確認ステップ(手順5)のズレ計算
- core 側の `noteToX` / `semitoneWidth` を再利用

### 5. カメラ共通フック `components/useHandCamera.ts`(リファクタリング)

CameraDebug のカメラ起動・デバイス列挙・HandTracker 初期化・rAF 検出ループ・fps 計測を
フックに抽出し、CameraDebug と CalibrationDebug で共用する(機能・見た目は変えない)。
毎フレームのコールバックで最新 LandmarkFrame を受け取れるようにする。

### 6. ウィザード画面 `components/CalibrationDebug.tsx`(F-03 手順 1〜5)

画面構成: カメラプレビュー(ランドマーク描画付き)+ バーチャル鍵盤(F-02 のものを再利用)+ ウィザード。
実 MIDI が無くても進められる(ユーザー指示)。

ステップ:
1. **準備**: 「鍵盤全体が映るようにカメラを設置してください」ガイド + 認識状態表示 → 「開始」ボタン
2. **低い基準鍵盤**: 「低い方の基準鍵盤を 1 つ押してください(手順3の鍵盤と 1 オクターブ以上離すこと)」
   → Note On で、**リングバッファから Note On 時刻に最も近いフレーム**を取り、最下指先の x を記録。
   手が検出されていない打鍵は「手が見えていません」と表示してやり直し
3. **高い基準鍵盤**: 同様に記録。低い方と同一ノートなら再入力を促す。
   1 オクターブ未満しか離れていない場合は「精度が落ちます。やり直しを推奨」と警告(強制はしない=ガイド明記の趣旨)
4. **線形補間**: buildCalibration で対応表を作成(手順4。画面上は自動)
5. **確認**: 「適当な鍵盤を数回押してください」→ 打鍵ごとに推定位置とのズレ(半音間隔比)を一覧表示。
   **0.5 を超えた打鍵が 1 回でもあれば「再キャリブレーションを推奨」を表示**(強制しない。やり直しボタンは常設)。
   手が未検出の打鍵は「手未検出」として一覧に出し、0.5 超のカウントには含めない
6. **完了(指特定デバッグ)**: Note On ごとに `estimateFinger` を実行し、
   「ノート名 / 対象の手 / 推定指番号 / 距離・マージン(信頼度)/ 判定不能の理由」を履歴リストで表示。
   対象の手はデバッグ用トグル(右手/左手)で選ぶ(本来は譜面 note の hand を使う。接続は P4)

フレーム選択の統一: ステップ 2・3(基準点記録)だけでなく、**ステップ 5(ズレ計算)・6(指特定)でも
必ずリングバッファの `getNearestFrame(NoteOnの時刻)` を使う**(7.2 重要注記の適用箇所)。

MIDI 購読は具象クラスではなく `MidiSource` インターフェース経由にする(F-02「入力源を区別しない」。
P4 以降で実デバイス midiInput.ts をそのまま挿せるように)。

制約の実装:
- キャリブレーション結果は **React state のみ(メモリ内)**。保存しない(F-03)
- **カメラ変更・ミラー切替でキャリブレーションを破棄**してウィザード先頭に戻す(F-03「再キャリブレーション必須」。
  ※ 本実装のミラーは表示のみで内部座標は不変だが、仕様の文言に従い安全側でリセットする)

### 7. テスト

- fingerEstimator: 対象手なし→handNotDetected / 5 指の最近傍→正しい指番号 / 0.6 超→tooFar /
  拮抗→y で解消(y 大が勝つ)/ y も僅差→ambiguous / 反対の手は候補から除外 /
  半音幅が負(カメラ左右逆置き)でも正しく動く / frame null→判定不能
- calibration: 線形補間の正確さ / 同一ノートでエラー / 最下指先の選択(両手の全指先から y 最大)/ ズレ計算

## 実装手順(作業単位ごとに commit)

1. 本計画を commit
2. 型・定数 + fingerEstimator + テスト → `npm run test` → commit
3. vision/calibration.ts + テスト → commit
4. useHandCamera 抽出 + CameraDebug リファクタリング(動作確認)→ commit
5. CalibrationDebug ウィザード + App タブ → ブラウザ動作確認 → commit
6. README(P3 動作確認手順)+ CLAUDE.md 進捗ログ → commit

## 完了条件と検証

- `npm run test` 全件パス(既存 26 件 + 新規)
- `npm run build` が通る
- ブラウザ(実カメラ環境はユーザーに依頼):
  1. P3 タブでウィザードが手順どおり進む(バーチャル鍵盤の打鍵で基準点が記録される)
  2. 確認ステップでズレが表示され、大きいズレで再キャリブレーション推奨が出る
  3. 完了後、鍵盤を押すたびに推定指番号と信頼度(または判定不能の理由)が表示される
  4. カメラ切替・ミラー切替でウィザードが最初に戻る
- カメラなし環境(この開発環境)では、手が映らない場合のガイド表示とウィザードの状態遷移を確認

## 仕様上の解釈・判断(レビュー観点)

- 「最も下(鍵盤側)にある指先」= 正規化 y 座標が最大の指先(カメラは鍵盤上方から撮影し、画像下側が鍵盤という前提。
  セットアップガイド文に「鍵盤が画面の下側になるように」と明記する)
- 拮抗時の y 比較「押下時は指先が下がる=鍵盤に近い」= y が大きい方を採用(同上の前提)
- 基準 2 鍵の「1 オクターブ以上離す」は**ガイド明記が仕様**なので強制しない。ただし同一ノートは補間計算が成立しないため再入力を求める(1 オクターブ未満は警告のみ)
- ミラー切替での再キャリブレーションは、本実装では座標系が実際には変わらないが仕様の文言(F-03)に従いリセットする
- 確認ステップのズレ計算には「最下指先の x」を使う(基準点記録と同じ定義。どの指で押しても成立するため)
- デバッグ表示の「信頼度」は 7.2 と同じ単位(半音間隔比)の距離・マージンの具体値を表示する
