// キャリブレーション計算(仕様書 F-03)のユニットテスト
import { describe, expect, it } from "vitest";
import {
  buildCalibration,
  deviationSemitones,
  findLowestFingertip,
} from "../../src/vision/calibration";
import type { DetectedHand, Hand, LandmarkFrame } from "../../src/core/types";

/** テスト用の手を作るヘルパー(指先 5 点のみ指定、他はダミー) */
function hand(tips: { x: number; y: number }[], handedness: Hand = "R"): DetectedHand {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0, y: -1, z: 0 }));
  const tipIndices = [4, 8, 12, 16, 20];
  tips.forEach((tip, i) => {
    landmarks[tipIndices[i]] = { ...tip, z: 0 };
  });
  return { handedness, score: 0.9, landmarks };
}

function frameWith(...hands: DetectedHand[]): LandmarkFrame {
  return { timestampMs: 0, hands };
}

describe("findLowestFingertip(最も下=鍵盤側の指先)", () => {
  it("手が無ければ null", () => {
    expect(findLowestFingertip(frameWith())).toBeNull();
  });

  it("全指先から y が最大のものを選ぶ", () => {
    const h = hand([
      { x: 0.1, y: 0.5 },
      { x: 0.2, y: 0.9 }, // これが最下(押している指)
      { x: 0.3, y: 0.6 },
      { x: 0.4, y: 0.4 },
      { x: 0.5, y: 0.3 },
    ]);
    expect(findLowestFingertip(frameWith(h))).toEqual({ x: 0.2, y: 0.9 });
  });

  it("両手が映っていれば両方の指先が候補になる(どの手で押すかは任意)", () => {
    const left = hand(
      [
        { x: 0.1, y: 0.5 },
        { x: 0.15, y: 0.95 }, // 左手の人差し指が最下
        { x: 0.2, y: 0.5 },
        { x: 0.25, y: 0.5 },
        { x: 0.3, y: 0.5 },
      ],
      "L",
    );
    const right = hand([
      { x: 0.6, y: 0.5 },
      { x: 0.65, y: 0.8 },
      { x: 0.7, y: 0.5 },
      { x: 0.75, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ]);
    expect(findLowestFingertip(frameWith(left, right))).toEqual({ x: 0.15, y: 0.95 });
  });
});

describe("buildCalibration(基準2点→線形補間)", () => {
  it("低い方・高い方を正しく並べる(順不同で渡して良い)", () => {
    const c = buildCalibration({ midi: 72, x: 0.7 }, { midi: 60, x: 0.1 });
    expect(c).toEqual({ lowMidi: 60, lowX: 0.1, highMidi: 72, highX: 0.7 });
  });

  it("同一ノートはエラー(補間が成立しない)", () => {
    expect(() => buildCalibration({ midi: 60, x: 0.1 }, { midi: 60, x: 0.5 })).toThrow();
  });
});

describe("deviationSemitones(確認ステップのズレ計算)", () => {
  // ド4(60)=0.1, ド5(72)=0.7 → 半音間隔 0.05
  const calib = buildCalibration({ midi: 60, x: 0.1 }, { midi: 72, x: 0.7 });

  it("推定位置ぴったりならズレ 0", () => {
    expect(deviationSemitones(calib, 62, 0.2)).toBeCloseTo(0);
  });

  it("ズレは半音間隔比で返る", () => {
    // レ4(62) の推定位置 0.2 に対し実測 0.225 → 0.025 / 0.05 = 0.5 半音
    expect(deviationSemitones(calib, 62, 0.225)).toBeCloseTo(0.5);
  });
});
