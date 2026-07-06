// 指特定ロジック(仕様書 7.2 — このプロジェクトの核心)
//
// Note On 受信時に、Note On の時刻に最も近いカメラフレームの手ランドマークから
// 「どの指で押したか」を推定する。UI・ブラウザ API に依存しない純 TypeScript(テスト対象)。
//
// 判定単位の原則(仕様書 7.2): 判定はイベント単位ではなく Note On 1 回ごとに独立して行う。
// 対象の手(hand)は譜面イベントの note から与えられる(P3 のデバッグ画面ではトグルで選択)。
//
// TODO(仕様書 7.2 の拡張余地。初期実装では不要):
// - Note On 直前数フレームの指先 y 座標の速度(下降検出)を加味する
// - カメラの遅延と MIDI のタイムスタンプの補正

import {
  FINGER_AMBIGUOUS_MARGIN_SEMITONES,
  FINGER_MAX_DISTANCE_SEMITONES,
  FINGER_Y_TIEBREAK_MIN_DIFF,
} from "./constants";
import type {
  DetectedHand,
  FingerEstimateResult,
  FingerNumber,
  Hand,
  KeyboardCalibration,
  LandmarkFrame,
} from "./types";

/** 指先ランドマークの index(MediaPipe Hands)。順に親指(1)〜小指(5) */
const FINGERTIP_LANDMARK_INDICES = [4, 8, 12, 16, 20] as const;

/**
 * ピッチクラス(ド=0〜シ=11)→ 鍵盤ジオメトリ上の位置(白鍵 1 個分 = 1.0)。
 * 実鍵盤の配置(仕様書 F-03 手順 4): 白鍵(ド レ ミ ファ ソ ラ シ)は等幅で 0〜6、
 * 黒鍵は隣り合う白鍵の境目(+0.5)。1 オクターブ = 白鍵 7 個分。
 */
const PITCH_CLASS_POSITIONS = [
  0, // ド
  0.5, // ド♯(ド・レの境目)
  1, // レ
  1.5, // レ♯
  2, // ミ
  3, // ファ(ミ・ファの間に黒鍵はない)
  3.5, // ファ♯
  4, // ソ
  4.5, // ソ♯
  5, // ラ
  5.5, // ラ♯
  6, // シ
] as const;

/** MIDI ノート番号 → 鍵盤ジオメトリ上の位置(白鍵 1 個分 = 1.0) */
export function keyPosition(midi: number): number {
  return Math.floor(midi / 12) * 7 + PITCH_CLASS_POSITIONS[midi % 12];
}

/** 白鍵 1 個ぶんの x 幅(正規化座標)。カメラの向きにより負になり得る */
function whiteKeyWidth(calibration: KeyboardCalibration): number {
  return (
    (calibration.highX - calibration.lowX) /
    (keyPosition(calibration.highMidi) - keyPosition(calibration.lowMidi))
  );
}

/**
 * 「平均半音間隔」1 つぶんの x 幅 = オクターブ幅の 1/12(仕様書 7.2 の信頼度の単位)。
 * 1 オクターブ = 白鍵 7 個分 = 12 半音なので、白鍵幅 × 7/12。
 * カメラの向きにより高音側が画面左になる配置では負になるため、
 * 距離計算には absSemitoneWidth を使うこと。
 */
export function semitoneWidth(calibration: KeyboardCalibration): number {
  return (whiteKeyWidth(calibration) * 7) / 12;
}

/** 平均半音間隔の絶対値(距離の正規化用) */
export function absSemitoneWidth(calibration: KeyboardCalibration): number {
  return Math.abs(semitoneWidth(calibration));
}

/**
 * ノート番号 → 映像内の鍵盤 x 座標(正規化)。
 * 基準 2 鍵から実鍵盤ジオメトリ上で線形補間する(仕様書 F-03 手順 4)。
 * 白鍵は等間隔に並び、黒鍵はない場所(ミ・ファ / シ・ド間)は詰まらない。
 */
export function noteToX(calibration: KeyboardCalibration, midi: number): number {
  return (
    calibration.lowX +
    (keyPosition(midi) - keyPosition(calibration.lowMidi)) *
      whiteKeyWidth(calibration)
  );
}

/**
 * 対象の手を選ぶ。同じ handedness が複数検出された場合(MediaPipe の誤検出)は
 * handedness スコアが最大のものを採用する。
 */
function selectTargetHand(frame: LandmarkFrame, hand: Hand): DetectedHand | null {
  let best: DetectedHand | null = null;
  for (const h of frame.hands) {
    if (h.handedness !== hand) continue;
    if (best === null || h.score > best.score) best = h;
  }
  return best;
}

/**
 * 指特定(仕様書 7.2 の推定ロジック 1〜5)。
 *
 * @param frame Note On のタイムスタンプに最も近いフレーム(リングバッファから取得)。null = フレーム無し
 * @param hand 対象の手(譜面イベントの note の hand。反対の手は候補から除外する)
 * @param midi 押されたノート番号
 * @param calibration キャリブレーション結果
 */
export function estimateFinger(
  frame: LandmarkFrame | null,
  hand: Hand,
  midi: number,
  calibration: KeyboardCalibration,
): FingerEstimateResult {
  // ロジック 2: 対象の手が検出されていなければ判定不能
  if (frame === null) {
    return { status: "undetermined", reason: "handNotDetected" };
  }
  const targetHand = selectTargetHand(frame, hand);
  if (targetHand === null) {
    return { status: "undetermined", reason: "handNotDetected" };
  }

  // ロジック 1: ノート番号から鍵盤の x 座標を得る
  const kx = noteToX(calibration, midi);
  const unit = absSemitoneWidth(calibration);

  // ロジック 3: 5 指の指先について |指先x - kx| を平均半音間隔比で計算
  const candidates = FINGERTIP_LANDMARK_INDICES.map((landmarkIndex, i) => {
    const tip = targetHand.landmarks[landmarkIndex];
    return {
      finger: (i + 1) as FingerNumber, // 親指=1 〜 小指=5
      distance: Math.abs(tip.x - kx) / unit,
      y: tip.y,
    };
  }).sort((a, b) => a.distance - b.distance);

  const first = candidates[0];
  const second = candidates[1];

  // ロジック 5a: どの指も鍵盤に十分近くない → 判定不能
  if (first.distance > FINGER_MAX_DISTANCE_SEMITONES) {
    return { status: "undetermined", reason: "tooFar" };
  }

  const margin = second.distance - first.distance;

  // ロジック 5b: 1 位と 2 位が拮抗 → y 座標を第 2 の判定材料に使う
  // (押下時は指先が下がる=画像の下=鍵盤に近い。つまり y が大きい方を採用)
  if (margin < FINGER_AMBIGUOUS_MARGIN_SEMITONES) {
    const yDiff = Math.abs(first.y - second.y);
    if (yDiff < FINGER_Y_TIEBREAK_MIN_DIFF) {
      // y 座標も僅差 → 判定不能
      return { status: "undetermined", reason: "ambiguous" };
    }
    const winner = first.y > second.y ? first : second;
    return {
      status: "estimated",
      finger: winner.finger,
      distanceSemitones: winner.distance,
      marginSemitones: margin,
      usedYTieBreak: true,
    };
  }

  // ロジック 4: 最小距離の指先を「押した指」と推定
  return {
    status: "estimated",
    finger: first.finger,
    distanceSemitones: first.distance,
    marginSemitones: margin,
    usedYTieBreak: false,
  };
}
