// タイムスタンプ健全性チェック(仕様書 7.2)のユニットテスト
import { describe, expect, it } from "vitest";
import { MIDI_TIMESTAMP_SANITY_MS } from "../../src/core/constants";
import { sanitizeTimestamp } from "../../src/midi/timestamp";

describe("sanitizeTimestamp", () => {
  const now = 50_000;

  it("現在時刻に近い値はそのまま使い、差を返す", () => {
    expect(sanitizeTimestamp(now - 12, now)).toEqual({ timestampMs: now - 12, delta: -12 });
  });

  it("かけ離れた値(epoch 基準など)は現在時刻にフォールバックする", () => {
    expect(sanitizeTimestamp(1_700_000_000_000, now)).toEqual({ timestampMs: now, delta: 0 });
  });

  it("許容範囲ちょうどの差はフォールバックする(境界)", () => {
    expect(sanitizeTimestamp(now - MIDI_TIMESTAMP_SANITY_MS, now)).toEqual({
      timestampMs: now,
      delta: 0,
    });
  });

  it("0 以下・NaN・無限大はフォールバックする", () => {
    expect(sanitizeTimestamp(0, now).timestampMs).toBe(now);
    expect(sanitizeTimestamp(-5, now).timestampMs).toBe(now);
    expect(sanitizeTimestamp(Number.NaN, now).timestampMs).toBe(now);
    expect(sanitizeTimestamp(Number.POSITIVE_INFINITY, now).timestampMs).toBe(now);
  });
});
