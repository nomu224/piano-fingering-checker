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
 * 半音 1 つぶんの x 間隔(正規化座標)。
 * カメラの向きにより高音側が画面左になる配置では負になるため、
 * 距離計算には absSemitoneWidth を使うこと。
 */
export function semitoneWidth(calibration: KeyboardCalibration): number {
  return (
    (calibration.highX - calibration.lowX) /
    (calibration.highMidi - calibration.lowMidi)
  );
}

/** 半音間隔の絶対値(距離の正規化用) */
export function absSemitoneWidth(calibration: KeyboardCalibration): number {
  return Math.abs(semitoneWidth(calibration));
}

/**
 * ノート番号 → 映像内の鍵盤 x 座標(正規化)。
 * 基準 2 鍵の線形補間(半音単位で等間隔と近似。仕様書 F-03 手順 4)。
 */
export function noteToX(calibration: KeyboardCalibration, midi: number): number {
  return (
    calibration.lowX + (midi - calibration.lowMidi) * semitoneWidth(calibration)
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

  // ロジック 3: 5 指の指先について |指先x - kx| を半音間隔比で計算
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
