// MIDI 入力のタイムスタンプ健全性チェック(仕様書 7.2 の精度に直結)
//
// 実 MIDI 入力(Web MIDI)と Bluetooth MIDI 入力(F-10)の両方で使う。
// UI・ブラウザ API に依存しない純 TypeScript(テスト対象)。

import { MIDI_TIMESTAMP_SANITY_MS } from "../core/constants";

/** チェック結果 */
export interface SanitizedTimestamp {
  /** 判定に使う時刻(ms、performance.now() 基準) */
  timestampMs: number;
  /** 「イベント時刻 − 現在時刻」の差(ms)。遅延のデバッグ用。フォールバック時は 0 */
  delta: number;
}

/**
 * イベントの時刻が妥当かを確かめる。
 *
 * イベントの timeStamp は performance.now() と同一基準のはずだが、
 * 万一かけ離れた値(epoch 基準など)が来ると、ランドマーク履歴の最近傍検索が
 * 常に最古フレームを掴み、エラーも出さずに指特定が誤り続ける。
 * そのため妥当な範囲外なら現在時刻にフォールバックする。
 *
 * @param raw イベントの timeStamp
 * @param now 現在時刻(performance.now())。テストのため引数で受け取る
 */
export function sanitizeTimestamp(raw: number, now: number): SanitizedTimestamp {
  if (Number.isFinite(raw) && raw > 0 && Math.abs(raw - now) < MIDI_TIMESTAMP_SANITY_MS) {
    return { timestampMs: raw, delta: raw - now };
  }
  return { timestampMs: now, delta: 0 };
}
