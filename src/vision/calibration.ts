// キャリブレーション計算(仕様書 F-03)
//
// 「MIDI ノート番号 ⇔ カメラ映像内の鍵盤の x 座標」の対応表を作るための計算部。
// ウィザードの UI は components/CalibrationDebug.tsx が担い、ここは純 TypeScript の計算のみ
// (ブラウザ API 非依存・ユニットテスト対象)。
//
// 前提: カメラは鍵盤の上方に設置し、映像の下側が鍵盤になる向きで使う
// (ウィザードのガイド文にも明記する)。

import { absSemitoneWidth, noteToX } from "../core/fingerEstimator";
import type { KeyboardCalibration, LandmarkFrame } from "../core/types";

/** 基準鍵盤 1 つぶんの記録(F-03 手順 2・3) */
export interface ReferencePoint {
  /** 押された鍵盤のノート番号(MIDI から取得) */
  midi: number;
  /** そのとき最も下(鍵盤側)にあった指先の x 座標(正規化) */
  x: number;
}

/** フレーム内の「最も下(鍵盤側)にある指先」の座標。手が無ければ null */
export interface LowestFingertip {
  x: number;
  y: number;
}

/** 指先ランドマークの index(MediaPipe Hands) */
const FINGERTIP_LANDMARK_INDICES = [4, 8, 12, 16, 20] as const;

/**
 * フレーム内の全検出手・全指先から「最も下(=正規化 y が最大=鍵盤側)」の指先を返す(F-03 手順 2)。
 * どの鍵盤をどの手・どの指で押すかはユーザーの任意のため、両手すべての指先を候補にする。
 */
export function findLowestFingertip(frame: LandmarkFrame): LowestFingertip | null {
  let lowest: LowestFingertip | null = null;
  for (const hand of frame.hands) {
    for (const i of FINGERTIP_LANDMARK_INDICES) {
      const tip = hand.landmarks[i];
      if (lowest === null || tip.y > lowest.y) {
        lowest = { x: tip.x, y: tip.y };
      }
    }
  }
  return lowest;
}

/**
 * 基準 2 点からキャリブレーション結果を作る(F-03 手順 4)。
 * 低い方・高い方の順不同で渡してよい(内部で並べ替える)。
 * 同一ノートは線形補間が成立しないためエラー。
 */
export function buildCalibration(
  a: ReferencePoint,
  b: ReferencePoint,
): KeyboardCalibration {
  if (a.midi === b.midi) {
    throw new Error("基準の 2 鍵盤が同じです。別の鍵盤でやり直してください");
  }
  const [low, high] = a.midi < b.midi ? [a, b] : [b, a];
  return {
    lowMidi: low.midi,
    lowX: low.x,
    highMidi: high.midi,
    highX: high.x,
  };
}

/**
 * 確認ステップ(F-03 手順 5)のズレ計算。
 * 押された鍵盤の推定 x 座標と、実際の打鍵時の最下指先 x との差を半音間隔比で返す。
 * 0.5 を超えたら「隣の鍵盤と取り違えるレベル」(閾値は constants.CALIBRATION_MAX_DEVIATION_SEMITONES)。
 */
export function deviationSemitones(
  calibration: KeyboardCalibration,
  midi: number,
  fingertipX: number,
): number {
  return (
    Math.abs(fingertipX - noteToX(calibration, midi)) /
    absSemitoneWidth(calibration)
  );
}
