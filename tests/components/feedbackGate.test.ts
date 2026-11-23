// フィードバック音を鳴らすかの判断(仕様書 F-05 / F-13)のユニットテスト
//
// 記録のみモード(F-13)は「鳴らないのが正常」なため、壊れても画面上では気付けない。
// 実験データを守るため、ここで全組み合わせを固定する。
import { describe, expect, it } from "vitest";
import { feedbackToPlay } from "../../src/components/feedbackGate";
import type { JudgmentEntry } from "../../src/core/types";

const ALL_FEEDBACK: JudgmentEntry["feedback"][] = ["none", "correct", "noteMiss", "fingerMiss"];

describe("feedbackToPlay", () => {
  describe("記録のみモード(F-13)", () => {
    it("フィードバック種別と設定の全組み合わせで必ず無音になる", () => {
      for (const feedback of ALL_FEEDBACK) {
        for (const clickOnCorrect of [true, false]) {
          expect(feedbackToPlay(feedback, true, clickOnCorrect)).toBe("none");
        }
      }
    });
  });

  describe("通常モード", () => {
    it("音ミスはビープ B を鳴らす", () => {
      expect(feedbackToPlay("noteMiss", false, false)).toBe("noteMiss");
      expect(feedbackToPlay("noteMiss", false, true)).toBe("noteMiss");
    });

    it("運指ミスはビープ A を鳴らす", () => {
      expect(feedbackToPlay("fingerMiss", false, false)).toBe("fingerMiss");
      expect(feedbackToPlay("fingerMiss", false, true)).toBe("fingerMiss");
    });

    it("正解は既定で無音、設定が ON のときだけクリック音(F-05)", () => {
      expect(feedbackToPlay("correct", false, false)).toBe("none");
      expect(feedbackToPlay("correct", false, true)).toBe("click");
    });

    it("フィードバックなし(重複打鍵など)は常に無音", () => {
      expect(feedbackToPlay("none", false, true)).toBe("none");
      expect(feedbackToPlay("none", false, false)).toBe("none");
    });
  });
});
