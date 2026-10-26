// 楽譜上の位置の対応づけ(仕様書 F-11)
//
// 判定エンジンの進行位置(何番目のイベントか)を、楽譜上の位置に変換する。
//
// 【重要】音符の並び順では対応づけられない。
// 変換(musicxml.ts)のときに休符・タイでつながれた音・装飾音を除外しているため、
// 「アプリの 3 番目の音」と「楽譜の 3 番目の音符」は一致しないため。
// そこで、変換時に記録した「何小節目(出現順)の、小節内のどの位置(四分音符単位)か」で突き合わせる。
//
// UI・ブラウザ API に依存しない純 TypeScript(テスト対象)。

import type { ScoreEvent } from "../core/types";

/** 楽譜上の位置 */
export interface ScorePosition {
  /** 出現順の小節インデックス(0 始まり) */
  measureIndex: number;
  /** 小節内の発音位置(四分音符単位) */
  onsetQuarters: number;
}

/**
 * 位置の比較で「同じ」とみなす許容誤差。
 * 3 連符などで小数の誤差が出るため、厳密な等値比較はしない。
 */
export const POSITION_EPSILON = 1e-4;

/**
 * イベントから楽譜上の位置を取り出す。
 * 古い保存データには位置情報が無いので、その場合は null(= 楽譜のハイライトはしない)。
 */
export function toScorePosition(event: ScoreEvent | null | undefined): ScorePosition | null {
  if (!event) return null;
  const { measureIndex, onsetQuarters } = event;
  if (typeof measureIndex !== "number" || typeof onsetQuarters !== "number") return null;
  if (!Number.isFinite(measureIndex) || !Number.isFinite(onsetQuarters)) return null;
  return { measureIndex, onsetQuarters };
}

/**
 * 2 つの位置を比べる。
 * a が前なら負、同じなら 0、a が後なら正を返す(配列の並べ替えと同じ約束)。
 */
export function comparePosition(
  a: ScorePosition,
  b: ScorePosition,
  epsilon: number = POSITION_EPSILON,
): number {
  if (a.measureIndex !== b.measureIndex) return a.measureIndex - b.measureIndex;
  const diff = a.onsetQuarters - b.onsetQuarters;
  if (Math.abs(diff) <= epsilon) return 0;
  return diff;
}

/** 同じ位置か */
export function isSamePosition(
  a: ScorePosition | null,
  b: ScorePosition | null,
  epsilon: number = POSITION_EPSILON,
): boolean {
  if (!a || !b) return a === b;
  return comparePosition(a, b, epsilon) === 0;
}
