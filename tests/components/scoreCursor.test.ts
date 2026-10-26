// 楽譜上の位置の対応づけ(仕様書 F-11)のユニットテスト
import { describe, expect, it } from "vitest";
import {
  comparePosition,
  isSamePosition,
  toScorePosition,
  type ScorePosition,
} from "../../src/components/scoreCursor";
import type { ScoreEvent } from "../../src/core/types";

/** テスト用のイベントを作る */
function event(over: Partial<ScoreEvent> = {}): ScoreEvent {
  return {
    index: 0,
    measure: 1,
    measureIndex: 0,
    onsetQuarters: 0,
    posInMeasure: 1,
    notes: [{ midi: 60, finger: 1, hand: "R" }],
    ...over,
  };
}

const at = (measureIndex: number, onsetQuarters: number): ScorePosition => ({
  measureIndex,
  onsetQuarters,
});

describe("toScorePosition", () => {
  it("位置情報を持つイベントから位置を取り出す", () => {
    expect(toScorePosition(event({ measureIndex: 2, onsetQuarters: 1.5 }))).toEqual(at(2, 1.5));
  });

  it("位置情報の無い古いデータでは null(ハイライトしない)", () => {
    const old = event();
    delete old.measureIndex;
    delete old.onsetQuarters;
    expect(toScorePosition(old)).toBeNull();
  });

  it("片方だけ欠けていても null", () => {
    const half = event();
    delete half.onsetQuarters;
    expect(toScorePosition(half)).toBeNull();
  });

  it("イベントが無い(曲の終わり)ときも null", () => {
    expect(toScorePosition(null)).toBeNull();
    expect(toScorePosition(undefined)).toBeNull();
  });
});

describe("comparePosition", () => {
  it("小節が違えば小節で比べる", () => {
    expect(comparePosition(at(0, 3), at(1, 0))).toBeLessThan(0);
    expect(comparePosition(at(2, 0), at(1, 3))).toBeGreaterThan(0);
  });

  it("同じ小節なら拍の位置で比べる", () => {
    expect(comparePosition(at(1, 0), at(1, 2))).toBeLessThan(0);
    expect(comparePosition(at(1, 2), at(1, 0))).toBeGreaterThan(0);
  });

  it("まったく同じ位置は 0", () => {
    expect(comparePosition(at(1, 1.5), at(1, 1.5))).toBe(0);
  });

  it("小数の誤差があっても同じ位置とみなす(3 連符対策)", () => {
    // 1/3 を計算した値と、丸めて記録した値のずれ
    expect(comparePosition(at(0, 1 / 3), at(0, 0.333333))).toBe(0);
    expect(isSamePosition(at(0, 2 / 3), at(0, 0.666667))).toBe(true);
  });

  it("許容誤差を超える差は別の位置とみなす", () => {
    expect(comparePosition(at(0, 0.5), at(0, 0.51))).not.toBe(0);
  });
});

describe("isSamePosition", () => {
  it("どちらも null なら同じ扱い", () => {
    expect(isSamePosition(null, null)).toBe(true);
  });

  it("片方だけ null なら違う扱い", () => {
    expect(isSamePosition(at(0, 0), null)).toBe(false);
    expect(isSamePosition(null, at(0, 0))).toBe(false);
  });
});
