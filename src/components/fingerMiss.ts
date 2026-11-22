// 運指ミスの情報を判定ログから取り出す(仕様書 F-12)
//
// 【なぜログを見るのか】
// 和音は「同時に押す音のまとまり」だが、判定は Note On 1 回ごとに行われる(仕様書 7.3)。
// そのため直前の 1 打鍵だけを見ていると、和音の 1 音目でミスしても、
// 直後の 2 音目の判定で表示が上書きされて消えてしまう(実機で発覚した問題)。
// そこで「最後に運指ミスがあったイベント」を探し、そのイベントのミスをまとめて取り出す。
//
// UI・ブラウザ API に依存しない純 TypeScript(テスト対象)。

import type { FingerNumber, Hand, JudgmentEntry } from "../core/types";

/** 1 本の指のミス */
export interface FingerMiss {
  /** 実際に押されたノート番号(表示用。音名に変換する) */
  midi: number;
  /** 譜面が指定していた指 */
  expectedFinger: FingerNumber;
  /** 実際に使ったと推定された指 */
  actualFinger: FingerNumber;
}

/** 片手ぶんのミスのまとまり */
export interface HandMisses {
  hand: Hand;
  misses: FingerMiss[];
}

/**
 * 判定ログから「最後に運指ミスがあったイベント」のミスを手ごとに集める。
 * ミスが一度も無ければ null(= 図を出さない)。
 *
 * - 判定不能(undetermined)は、設定でミス扱いにしていても対象外。
 *   どの指で弾いたか分かっていないため、図に描けない(仕様書 F-12)
 * - 音ミス・重複打鍵・運指情報なしも対象外
 */
export function collectLastFingerMisses(
  log: readonly JudgmentEntry[],
): HandMisses[] | null {
  // 後ろから探して、最後に運指ミスがあったイベントを特定する
  let targetEventIndex: number | null = null;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].fingering.kind === "miss") {
      targetEventIndex = log[i].eventIndex;
      break;
    }
  }
  if (targetEventIndex === null) return null;

  // そのイベントのミスを手ごとにまとめる(和音なら複数、両手なら 2 手ぶん)
  const byHand = new Map<Hand, FingerMiss[]>();
  for (const entry of log) {
    if (entry.eventIndex !== targetEventIndex) continue;
    const f = entry.fingering;
    if (f.kind !== "miss") continue;

    // 運指ミスは「音が正解だったとき」にしか起きないので、押した音の手が分かる。
    // 念のため取れない場合はそのミスを飛ばす(壊れたログへの防御)
    const s = entry.soundResult;
    if (s.type !== "correct" && s.type !== "finished") continue;
    const hand = s.note?.hand;
    if (hand !== "L" && hand !== "R") continue;

    const list = byHand.get(hand) ?? [];
    list.push({
      midi: entry.playedMidi,
      expectedFinger: f.expectedFinger,
      actualFinger: f.estimated.finger,
    });
    byHand.set(hand, list);
  }

  if (byHand.size === 0) return null;
  // 右手・左手の順で返す(画面での並びを安定させるため)
  const result: HandMisses[] = [];
  for (const hand of ["R", "L"] as const) {
    const misses = byHand.get(hand);
    if (misses && misses.length > 0) result.push({ hand, misses });
  }
  return result;
}
