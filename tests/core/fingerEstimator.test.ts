// 指特定ロジック(仕様書 7.2)のユニットテスト
import { describe, expect, it } from "vitest";
import {
  absSemitoneWidth,
  estimateFinger,
  noteToX,
  semitoneWidth,
} from "../../src/core/fingerEstimator";
import type {
  DetectedHand,
  Hand,
  KeyboardCalibration,
  LandmarkFrame,
} from "../../src/core/types";

/**
 * テスト用キャリブレーション:
 * ド4(60) が x=0.1、ド5(72) が x=0.7
 * → 白鍵 1 個分 = 0.6 / 7、平均半音間隔 = 0.6 / 12 = 0.05
 */
const CALIB: KeyboardCalibration = {
  lowMidi: 60,
  lowX: 0.1,
  highMidi: 72,
  highX: 0.7,
};

/** 白鍵 1 個分の x 幅(テスト内の期待値計算用) */
const W = 0.6 / 7;

/**
 * テスト用の手を作るヘルパー。
 * tips は親指〜小指の指先 5 点の座標(y 省略時は 0.5)。
 * 指先以外のランドマークはダミー(指特定では使われない)。
 */
function hand(
  tips: { x: number; y?: number }[],
  handedness: Hand = "R",
  score = 0.9,
): DetectedHand {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const tipIndices = [4, 8, 12, 16, 20];
  tips.forEach((tip, i) => {
    landmarks[tipIndices[i]] = { x: tip.x, y: tip.y ?? 0.5, z: 0 };
  });
  return { handedness, score, landmarks };
}

function frameWith(...hands: DetectedHand[]): LandmarkFrame {
  return { timestampMs: 0, hands };
}

describe("キャリブレーションの座標変換(実鍵盤ジオメトリ。F-03 手順 4)", () => {
  it("基準点の再現と平均半音間隔(オクターブ幅の 1/12)が正しい", () => {
    expect(semitoneWidth(CALIB)).toBeCloseTo(0.05);
    expect(noteToX(CALIB, 60)).toBeCloseTo(0.1);
    expect(noteToX(CALIB, 72)).toBeCloseTo(0.7);
  });

  it("白鍵は等間隔に並ぶ(黒鍵の無いミ・ファ間も詰まらない)", () => {
    expect(noteToX(CALIB, 62)).toBeCloseTo(0.1 + W); // レ4
    expect(noteToX(CALIB, 64)).toBeCloseTo(0.1 + 2 * W); // ミ4
    expect(noteToX(CALIB, 65)).toBeCloseTo(0.1 + 3 * W); // ファ4(ミとの間に黒鍵なしでも 1 白鍵分)
    expect(noteToX(CALIB, 71)).toBeCloseTo(0.1 + 6 * W); // シ4
  });

  it("黒鍵は隣り合う白鍵の境目に来る", () => {
    expect(noteToX(CALIB, 61)).toBeCloseTo(0.1 + 0.5 * W); // ド♯4
    expect(noteToX(CALIB, 66)).toBeCloseTo(0.1 + 3.5 * W); // ファ♯4
  });

  it("基準の範囲外へも外挿できる", () => {
    expect(noteToX(CALIB, 59)).toBeCloseTo(0.1 - W); // シ3(1 白鍵分左)
  });

  it("高音側が画面左になる配置(幅が負)でも補間できる", () => {
    const reversed: KeyboardCalibration = {
      lowMidi: 60,
      lowX: 0.9,
      highMidi: 72,
      highX: 0.3,
    };
    expect(semitoneWidth(reversed)).toBeCloseTo(-0.05);
    expect(absSemitoneWidth(reversed)).toBeCloseTo(0.05);
    expect(noteToX(reversed, 62)).toBeCloseTo(0.9 - 0.6 / 7); // レ4 は 1 白鍵分「左」
  });
});

describe("estimateFinger: 判定不能(handNotDetected)", () => {
  it("フレームが無い(null)なら判定不能", () => {
    expect(estimateFinger(null, "R", 60, CALIB)).toEqual({
      status: "undetermined",
      reason: "handNotDetected",
    });
  });

  it("対象の手が検出されていなければ判定不能(仕様 7.2 ロジック 2)", () => {
    // 左手しか映っていないのに右手の音を判定しようとした場合
    const frame = frameWith(hand([{ x: 0.1 }, { x: 0.2 }, { x: 0.3 }, { x: 0.4 }, { x: 0.5 }], "L"));
    expect(estimateFinger(frame, "R", 60, CALIB)).toEqual({
      status: "undetermined",
      reason: "handNotDetected",
    });
  });
});

describe("estimateFinger: 最近傍の指の推定", () => {
  it("鍵盤位置に最も近い指先が採用され、指番号 1〜5 に対応する", () => {
    // 各指を 3 半音(0.15)ずつ離して配置。ド4(x=0.1)に親指がぴったり
    const tips = [
      { x: 0.1 }, // 親指 → ド4 に一致
      { x: 0.25 },
      { x: 0.4 },
      { x: 0.55 },
      { x: 0.7 },
    ];
    const frame = frameWith(hand(tips));

    const r1 = estimateFinger(frame, "R", 60, CALIB);
    expect(r1).toMatchObject({ status: "estimated", finger: 1, usedYTieBreak: false });

    // 指番号対応の確認は指先がぴったり一致するケースで行う
    // ※ ファ♯4(66)はオクターブの厳密な中点なので、補間方式の変更前後で x=0.4 のまま変わらない
    const r3 = estimateFinger(frame, "R", 66, CALIB); // x = 0.4 → 中指(3)が一致
    expect(r3).toMatchObject({ status: "estimated", finger: 3 });

    const r5 = estimateFinger(frame, "R", 72, CALIB); // x = 0.7 → 小指(5)が一致
    expect(r5).toMatchObject({ status: "estimated", finger: 5 });
  });

  it("距離とマージンが半音間隔比で返る(信頼度のデバッグ表示用)", () => {
    const tips = [
      { x: 0.11 }, // 親指: ド4(0.1) から 0.01 = 0.2 半音
      { x: 0.3 }, // 人差し指: 0.2 = 4.0 半音
      { x: 0.5 },
      { x: 0.6 },
      { x: 0.65 },
    ];
    const r = estimateFinger(frameWith(hand(tips)), "R", 60, CALIB);
    expect(r.status).toBe("estimated");
    if (r.status === "estimated") {
      expect(r.finger).toBe(1);
      expect(r.distanceSemitones).toBeCloseTo(0.2);
      expect(r.marginSemitones).toBeCloseTo(3.8); // 4.0 - 0.2
    }
  });

  it("反対の手は候補から除外される(両手が近接しても誤判定しない)", () => {
    // 左手の指先が鍵盤位置ぴったりにあるが、右手の音なので右手だけで判定
    const left = hand([{ x: 0.1 }, { x: 0.12 }, { x: 0.14 }, { x: 0.16 }, { x: 0.18 }], "L");
    // 右手は少し離れた位置(人差し指が 0.5 半音 = 0.025)
    const right = hand([{ x: 0.5 }, { x: 0.125 }, { x: 0.5 }, { x: 0.6 }, { x: 0.7 }], "R");
    const r = estimateFinger(frameWith(left, right), "R", 60, CALIB);
    expect(r).toMatchObject({ status: "estimated", finger: 2 });
  });

  it("同じ handedness が複数検出されたら score 最大の手を使う", () => {
    const ghost = hand([{ x: 0.9 }, { x: 0.9 }, { x: 0.9 }, { x: 0.9 }, { x: 0.9 }], "R", 0.3);
    const real = hand([{ x: 0.1 }, { x: 0.3 }, { x: 0.5 }, { x: 0.6 }, { x: 0.7 }], "R", 0.95);
    const r = estimateFinger(frameWith(ghost, real), "R", 60, CALIB);
    expect(r).toMatchObject({ status: "estimated", finger: 1 });
  });
});

describe("estimateFinger: 判定不能(tooFar)", () => {
  it("最小距離が 0.6 半音を超えたら判定不能(仕様 7.2)", () => {
    // 最も近い親指でも 0.04 / 0.05 = 0.8 半音
    const tips = [{ x: 0.14 }, { x: 0.3 }, { x: 0.5 }, { x: 0.6 }, { x: 0.7 }];
    expect(estimateFinger(frameWith(hand(tips)), "R", 60, CALIB)).toEqual({
      status: "undetermined",
      reason: "tooFar",
    });
  });
});

describe("estimateFinger: 拮抗時の y 座標判定", () => {
  it("1位と2位の差が 0.25 半音未満なら y が大きい(鍵盤に近い)方を採用", () => {
    const tips = [
      { x: 0.11, y: 0.8 }, // 親指: 0.2 半音、下にある(押している)
      { x: 0.12, y: 0.5 }, // 人差し指: 0.4 半音、上にある
      { x: 0.5 },
      { x: 0.6 },
      { x: 0.7 },
    ];
    const r = estimateFinger(frameWith(hand(tips)), "R", 60, CALIB);
    expect(r).toMatchObject({ status: "estimated", finger: 1, usedYTieBreak: true });
  });

  it("距離 2 位でも y が大きければそちらを採用する", () => {
    const tips = [
      { x: 0.11, y: 0.5 }, // 親指: 距離 1 位だが上にある
      { x: 0.12, y: 0.8 }, // 人差し指: 距離 2 位だが下にある(押している)
      { x: 0.5 },
      { x: 0.6 },
      { x: 0.7 },
    ];
    const r = estimateFinger(frameWith(hand(tips)), "R", 60, CALIB);
    expect(r).toMatchObject({ status: "estimated", finger: 2, usedYTieBreak: true });
  });

  it("y 座標差も僅差(画像高さの 2% 未満)なら判定不能", () => {
    const tips = [
      { x: 0.11, y: 0.5 },
      { x: 0.12, y: 0.51 }, // y 差 0.01 < 0.02
      { x: 0.5 },
      { x: 0.6 },
      { x: 0.7 },
    ];
    expect(estimateFinger(frameWith(hand(tips)), "R", 60, CALIB)).toEqual({
      status: "undetermined",
      reason: "ambiguous",
    });
  });
});
