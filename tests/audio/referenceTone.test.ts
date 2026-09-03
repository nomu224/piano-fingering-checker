// 参照音(仕様書 F-08)のユニットテスト
// Web Audio API は Node に無いため、純関数 midiToFrequency のみを対象にする
// (発音そのものはブラウザでの動作確認で担保する)。
import { describe, expect, it } from "vitest";
import { midiToFrequency } from "../../src/audio/referenceTone";

describe("midiToFrequency", () => {
  it("A4(ノート番号 69)は 440Hz", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
  });

  it("オクターブ違いは周波数が 2 倍・1/2 になる", () => {
    expect(midiToFrequency(57)).toBeCloseTo(220, 6); // A3
    expect(midiToFrequency(81)).toBeCloseTo(880, 6); // A5
  });

  it("中央のド(C4 = 60)はおよそ 261.63Hz", () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 2);
  });

  it("半音上がると 2^(1/12) 倍になる", () => {
    const ratio = midiToFrequency(61) / midiToFrequency(60);
    expect(ratio).toBeCloseTo(Math.pow(2, 1 / 12), 6);
  });

  it("音が高いほど周波数が大きい(単調増加)", () => {
    expect(midiToFrequency(48)).toBeLessThan(midiToFrequency(60));
    expect(midiToFrequency(60)).toBeLessThan(midiToFrequency(72));
  });
});
