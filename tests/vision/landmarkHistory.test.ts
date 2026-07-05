// ランドマーク履歴リングバッファ(仕様書 7.2)のユニットテスト
import { describe, expect, it } from "vitest";
import { LandmarkHistory } from "../../src/vision/landmarkHistory";
import type { LandmarkFrame } from "../../src/core/types";

/** テスト用フレームを作るヘルパー(手の中身は空で良い) */
function frame(timestampMs: number): LandmarkFrame {
  return { timestampMs, hands: [] };
}

describe("LandmarkHistory", () => {
  it("空のときは null を返す", () => {
    const h = new LandmarkHistory(5);
    expect(h.getNearestFrame(100)).toBeNull();
    expect(h.getLatestFrame()).toBeNull();
    expect(h.size()).toBe(0);
  });

  it("タイムスタンプに最も近いフレームを返す(前後の比較)", () => {
    const h = new LandmarkHistory(5);
    h.push(frame(100));
    h.push(frame(133));
    h.push(frame(166));

    expect(h.getNearestFrame(130)?.timestampMs).toBe(133); // 100 より 133 が近い
    expect(h.getNearestFrame(150)?.timestampMs).toBe(166); // 133 より 166 が近い
    expect(h.getNearestFrame(0)?.timestampMs).toBe(100); // 範囲外でも最も近いもの
    expect(h.getNearestFrame(9999)?.timestampMs).toBe(166);
  });

  it("満杯になると最も古いフレームが上書きされる", () => {
    const h = new LandmarkHistory(3);
    h.push(frame(1));
    h.push(frame(2));
    h.push(frame(3));
    h.push(frame(4)); // ここで timestampMs=1 が消える

    expect(h.size()).toBe(3);
    // 消えた 1 に近い時刻を聞いても、残っている中で最も近い 2 が返る
    expect(h.getNearestFrame(1)?.timestampMs).toBe(2);
    expect(h.getNearestFrame(4)?.timestampMs).toBe(4);
  });

  it("getLatestFrame は最後に push したフレームを返す(上書き後も正しい)", () => {
    const h = new LandmarkHistory(3);
    h.push(frame(1));
    h.push(frame(2));
    expect(h.getLatestFrame()?.timestampMs).toBe(2);

    h.push(frame(3));
    h.push(frame(4)); // リングが一周
    expect(h.getLatestFrame()?.timestampMs).toBe(4);
  });

  it("clear で全消去できる", () => {
    const h = new LandmarkHistory(3);
    h.push(frame(1));
    h.clear();
    expect(h.size()).toBe(0);
    expect(h.getNearestFrame(1)).toBeNull();
    expect(h.getLatestFrame()).toBeNull();
  });

  it("サイズ 0 以下はエラー", () => {
    expect(() => new LandmarkHistory(0)).toThrow();
  });

  it("既定サイズは仕様書 7.2 の「直近 5 フレーム程度」", () => {
    const h = new LandmarkHistory();
    for (let i = 1; i <= 10; i++) h.push(frame(i));
    expect(h.size()).toBe(5);
  });
});
