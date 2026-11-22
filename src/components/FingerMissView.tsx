// ミスした指の図示(仕様書 F-12)
//
// 運指ミスのとき、手の図で「正解の指」と「実際に使った指」を示す。
// 文字(F-05 の「正解 1 / 実際 3」)だけでは、和音や両手のときに
// どの指が違ったのか直感的に分からないため。
//
// 【色だけに頼らない】緑と赤は色覚によって見分けにくい組み合わせなので、
// 色に加えて「塗り / 枠線」という形の違いと、指番号でも区別できるようにしている。
// また、指の入れ替わり(2 と 3 を逆に弾く)では同じ指が「正解」と「実際」の両方になるため、
// 塗りと枠を別々に使うことで両方を 1 本の指に重ねて表せる。

import type { FingerNumber } from "../core/types";
import { noteName } from "../midi/virtualKeyboard";
import type { FingerMiss, HandMisses } from "./fingerMiss";

/** 実際に使った指の色(塗り) */
const ACTUAL_COLOR = "#ef5350";
/** 譜面が指定していた指の色(枠線) */
const EXPECTED_COLOR = "#4caf50";
/** それ以外の指 */
const PLAIN_COLOR = "#555";

/** キャプションに出す行数の上限(増えすぎて枠からはみ出さないように) */
const MAX_CAPTION_LINES = 3;

interface Props {
  handMisses: HandMisses[];
}

/** 指 1 本ぶんの描画情報 */
interface FingerShape {
  /** 中心の x(SVG 座標) */
  x: number;
  /** 指の長さ */
  length: number;
}

/**
 * 指の配置(右手を正面から見た形)。親指(1)が左端で短く、中指(3)が一番長い。
 * 左手は x の並びを逆にするだけで描ける(SVG の反転は使わない。数字まで反転してしまうため)。
 */
const FINGER_SHAPES: FingerShape[] = [
  { x: 16, length: 26 }, // 1 親指
  { x: 36, length: 42 }, // 2 人差し指
  { x: 54, length: 48 }, // 3 中指
  { x: 72, length: 42 }, // 4 薬指
  { x: 90, length: 32 }, // 5 小指
];

/** 手のひらの上端(指はここから上に伸びる) */
const PALM_TOP = 72;

function HandSvg({ hand, misses }: HandMisses) {
  const expected = new Set<FingerNumber>(misses.map((m) => m.expectedFinger));
  const actual = new Set<FingerNumber>(misses.map((m) => m.actualFinger));

  return (
    <svg width="110" height="112" viewBox="0 0 110 112" role="img" aria-label="ミスした指">
      {/* 手のひら */}
      <rect x="10" y={PALM_TOP} width="86" height="32" rx="8" fill={PLAIN_COLOR} />
      {FINGER_SHAPES.map((shape, i) => {
        const finger = (i + 1) as FingerNumber;
        // 左手は左右の並びを入れ替える(親指が右端に来る)
        const x = hand === "L" ? 106 - shape.x : shape.x;
        const isActual = actual.has(finger);
        const isExpected = expected.has(finger);
        const top = PALM_TOP - shape.length;
        return (
          <g key={finger}>
            <rect
              x={x - 8}
              y={top}
              width="16"
              height={shape.length + 10}
              rx="8"
              fill={isActual ? ACTUAL_COLOR : PLAIN_COLOR}
              stroke={isExpected ? EXPECTED_COLOR : "none"}
              strokeWidth={isExpected ? 3 : 0}
            />
            <text
              x={x}
              y={top + 14}
              textAnchor="middle"
              fontSize="12"
              fill="#fff"
              fontWeight="bold"
            >
              {finger}
            </text>
          </g>
        );
      })}
      <text x="55" y="108" textAnchor="middle" fontSize="12" fill="#ccc">
        {hand === "R" ? "右手" : "左手"}
      </text>
    </svg>
  );
}

/** キャプション 1 行(どの音で、どの指のはずが、どの指だったか) */
function missLine(m: FingerMiss): string {
  return `${noteName(m.midi)}: 正解 ${m.expectedFinger} / 実際 ${m.actualFinger}`;
}

export function FingerMissView({ handMisses }: Props) {
  if (handMisses.length === 0) return null;

  const lines = handMisses.flatMap((h) => h.misses.map(missLine));
  const shown = lines.slice(0, MAX_CAPTION_LINES);
  const rest = lines.length - shown.length;

  return (
    <div className="finger-miss-overlay">
      <div style={{ display: "flex", gap: 4 }}>
        {handMisses.map((h) => (
          <HandSvg key={h.hand} hand={h.hand} misses={h.misses} />
        ))}
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.4 }}>
        {shown.map((line) => (
          <div key={line}>{line}</div>
        ))}
        {rest > 0 && <div>他 {rest} 件</div>}
        <div style={{ color: "#aaa" }}>
          <span style={{ color: EXPECTED_COLOR }}>緑枠</span>=正解 /{" "}
          <span style={{ color: ACTUAL_COLOR }}>赤</span>=実際
        </div>
      </div>
    </div>
  );
}
