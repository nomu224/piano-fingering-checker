// フィードバック音を鳴らすかどうかの判断(仕様書 F-05 / F-13)
//
// なぜ関数に切り出すか:
// 記録のみモード(F-13)では音を 1 つも鳴らしてはいけない。しかし
// 「鳴らないのが正常」なモードなので、うっかり鳴るようにしてしまっても
// 実験が終わるまで誰も気付けない(=実験データが台無しになる)。
// そこで判断だけを純関数にし、「記録のみなら必ず無音」をユニットテストで固定する。
//
// 音を出す処理そのものは FeedbackSound(src/audio/feedback.ts)が持つ。
// ここは「どれを鳴らすか」を決めるだけで、音には一切触らない。
// ※ 参照音(F-08)はフィードバックではなく楽器の音なので、この関数の対象外(記録のみでも鳴らす)。

import type { JudgmentEntry } from "../core/types";

/** この打鍵で鳴らすべき音。"none" = 鳴らさない */
export type FeedbackToPlay = "none" | "noteMiss" | "fingerMiss" | "click";

/**
 * 鳴らすべき音を決める。
 *
 * @param feedback 判定エンジンが返した、この打鍵のフィードバック種別(F-05)
 * @param recordOnly 記録のみモード(F-13)か。true なら必ず "none"
 * @param clickOnCorrect 正解時にクリック音を鳴らす設定(F-07)
 */
export function feedbackToPlay(
  feedback: JudgmentEntry["feedback"],
  recordOnly: boolean,
  clickOnCorrect: boolean,
): FeedbackToPlay {
  // 【F-13】記録のみモードでは、設定が何であっても音を出さない。
  // この 1 行が実験の前提そのものなので、他の条件より先に判定する
  if (recordOnly) return "none";

  switch (feedback) {
    case "noteMiss":
      return "noteMiss";
    case "fingerMiss":
      return "fingerMiss";
    case "correct":
      // 正解は既定で無音。設定が ON のときだけクリック音(F-05)
      return clickOnCorrect ? "click" : "none";
    case "none":
      return "none";
  }
}
