// ミスした指の表示(仕様書 F-12)
//
// 左右の手の指を常に並べて表示し、運指ミスがあった指に色を付ける。
// 文字(「正解 1 / 実際 3」)だけでは、和音や両手のときに
// どの指が違ったのか直感的に分からないため。
//
// 【描き方】手全体は描かず、第 2 関節あたりで切った指先を縦長の丸で表す。
// 左手は親指が右端、右手は親指が左端に来るよう並べる(中央に親指が寄る=実際の手と同じ配置)。
//
// 【色だけに頼らない】緑と赤は色覚によって見分けにくい組み合わせなので、
// 色に加えて「塗り / 枠線」という形の違いと、指番号でも区別できるようにしている。
// 指の入れ替わり(2 と 3 を逆に弾く)では同じ指が「正解」と「実際」の両方になるため、
// 塗り(実際)と枠(正解)を別々に使うことで 1 本の指に重ねて表せる。

import type { FingerNumber, Hand } from "../core/types";
import { noteName } from "../midi/virtualKeyboard";
import type { FingerMiss, HandMisses } from "./fingerMiss";

/** 実際に使った指の色(塗り) */
const ACTUAL_COLOR = "#ef5350";
/** 譜面が指定していた指の色(枠線) */
const EXPECTED_COLOR = "#4caf50";
/** ミスしていない指 */
const PLAIN_COLOR = "#555";

/** キャプションの行数の上限(増えすぎて枠からはみ出さないように) */
const MAX_CAPTION_LINES = 3;

/** 指先の形: 幅・長さ・下端のずれ(親指は短く、少し下にずれる) */
const FINGER_SHAPES: { length: number; dropY: number }[] = [
  { length: 22, dropY: 8 }, // 1 親指
  { length: 34, dropY: 0 }, // 2 人差し指
  { length: 38, dropY: 0 }, // 3 中指
  { length: 34, dropY: 0 }, // 4 薬指
  { length: 26, dropY: 2 }, // 5 小指
];

const FINGER_W = 13;
const FINGER_GAP = 4;
/** 片手ぶんの幅 */
const HAND_W = FINGER_SHAPES.length * (FINGER_W + FINGER_GAP);
/** 左右の手の間隔 */
const HANDS_GAP = 22;
const SVG_W = HAND_W * 2 + HANDS_GAP;
const SVG_H = 56;
/** 指の下端をそろえる位置 */
const BASE_Y = 42;

interface Props {
  /** 手ごとのミス。空配列ならミス無し(すべて灰色で表示する) */
  handMisses: HandMisses[];
}

/** 片手ぶんの指を描く */
function HandFingers({ hand, x0, misses }: { hand: Hand; x0: number; misses: FingerMiss[] }) {
  const expected = new Set<FingerNumber>(misses.map((m) => m.expectedFinger));
  const actual = new Set<FingerNumber>(misses.map((m) => m.actualFinger));

  return (
    <g>
      {FINGER_SHAPES.map((shape, i) => {
        const finger = (i + 1) as FingerNumber;
        // 右手は親指(1)が左端、左手は親指が右端に来るようにする
        const slot = hand === "R" ? i : FINGER_SHAPES.length - 1 - i;
        const x = x0 + slot * (FINGER_W + FINGER_GAP);
        const bottom = BASE_Y + shape.dropY;
        const top = bottom - shape.length;
        const isActual = actual.has(finger);
        const isExpected = expected.has(finger);
        return (
          <g key={finger}>
            <rect
              x={x}
              y={top}
              width={FINGER_W}
              height={shape.length}
              rx={FINGER_W / 2}
              fill={isActual ? ACTUAL_COLOR : PLAIN_COLOR}
              stroke={isExpected ? EXPECTED_COLOR : "none"}
              strokeWidth={isExpected ? 2.5 : 0}
            />
            <text
              x={x + FINGER_W / 2}
              y={bottom - 6}
              textAnchor="middle"
              fontSize="10"
              fill="#fff"
              fontWeight="bold"
            >
              {finger}
            </text>
          </g>
        );
      })}
      <text
        x={x0 + HAND_W / 2 - FINGER_GAP / 2}
        y={SVG_H - 2}
        textAnchor="middle"
        fontSize="11"
        fill="#aaa"
      >
        {hand === "L" ? "左手" : "右手"}
      </text>
    </g>
  );
}

/** キャプション 1 行(どの音で、どの指のはずが、どの指だったか) */
function missLine(m: FingerMiss): string {
  return `${noteName(m.midi)}: 正解 ${m.expectedFinger} / 実際 ${m.actualFinger}`;
}

export function FingerMissView({ handMisses }: Props) {
  const find = (hand: Hand) => handMisses.find((h) => h.hand === hand)?.misses ?? [];
  const lines = handMisses.flatMap((h) => h.misses.map(missLine));
  const shown = lines.slice(0, MAX_CAPTION_LINES);
  const rest = lines.length - shown.length;

  return (
    <div className="finger-strip">
      <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`} role="img" aria-label="指の表示">
        <HandFingers hand="L" x0={0} misses={find("L")} />
        <HandFingers hand="R" x0={HAND_W + HANDS_GAP} misses={find("R")} />
      </svg>
      <div className="finger-strip-caption">
        {lines.length === 0 ? (
          <div style={{ color: "#8bc34a" }}>運指ミスなし</div>
        ) : (
          <>
            {shown.map((line) => (
              <div key={line} style={{ color: "#ff7043" }}>
                {line}
              </div>
            ))}
            {rest > 0 && <div style={{ color: "#ff7043" }}>他 {rest} 件</div>}
          </>
        )}
        <div style={{ color: "#888" }}>
          <span style={{ color: EXPECTED_COLOR }}>緑枠</span>=正解 /{" "}
          <span style={{ color: ACTUAL_COLOR }}>赤</span>=実際
        </div>
      </div>
    </div>
  );
}
