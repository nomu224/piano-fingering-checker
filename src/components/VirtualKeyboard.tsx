// バーチャル MIDI キーボードの鍵盤 UI(仕様書 F-02)
// 2 オクターブ分の鍵盤を表示し、クリック/タップで Note On/Off を発生させる。
// オクターブシフト ± ボタン付き(バイエル両手曲の低音域テストに必要)。

import { useEffect, useState } from "react";
import {
  KEY_TO_SEMITONE,
  noteName,
  VirtualMidiKeyboard,
} from "../midi/virtualKeyboard";

/** 1 オクターブ内の白鍵の半音位置 */
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/** 表示する鍵盤数(2 オクターブ + 最上のド = 25 鍵) */
const KEY_COUNT = 25;

/** 白鍵の総数(7 × 2 オクターブ + 1) */
const WHITE_COUNT = 15;

/** 半音位置 → PC キーのラベル(下のオクターブのみ表示) */
const SEMITONE_TO_KEY_LABEL: Record<number, string> = {};
for (const [key, semitone] of Object.entries(KEY_TO_SEMITONE)) {
  SEMITONE_TO_KEY_LABEL[semitone] = key.toUpperCase();
}

interface Props {
  keyboard: VirtualMidiKeyboard;
}

export function VirtualKeyboard({ keyboard }: Props) {
  const [baseNote, setBaseNote] = useState(keyboard.getBaseNote());
  const [pressed, setPressed] = useState<ReadonlySet<number>>(new Set());

  // 押下中の鍵盤のハイライト表示(Note On/Off を購読)
  useEffect(() => {
    const offOn = keyboard.addNoteOnListener(({ note }) =>
      setPressed((prev) => new Set(prev).add(note)),
    );
    const offOff = keyboard.addNoteOffListener(({ note }) =>
      setPressed((prev) => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      }),
    );
    return () => {
      offOn();
      offOff();
    };
  }, [keyboard]);

  // PC キーボード入力(仕様書 F-02)。キーリピートは除外する
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (keyboard.keyDown(e.key)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (keyboard.keyUp(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [keyboard]);

  const shift = (delta: 1 | -1) => {
    keyboard.shiftOctave(delta);
    setBaseNote(keyboard.getBaseNote());
  };

  const whiteWidth = 100 / WHITE_COUNT; // 白鍵 1 本の幅(%)

  // 白鍵・黒鍵のリストを作る
  const whiteKeys: { midi: number; whiteIndex: number }[] = [];
  const blackKeys: { midi: number; leftPercent: number }[] = [];
  for (let offset = 0; offset < KEY_COUNT; offset++) {
    const midi = baseNote + offset;
    const octave = Math.floor(offset / 12);
    const semitone = offset % 12;
    const whitePos = WHITE_SEMITONES.indexOf(semitone);
    if (whitePos >= 0) {
      whiteKeys.push({ midi, whiteIndex: octave * 7 + whitePos });
    } else {
      // 黒鍵は直前の白鍵の右端に重ねて表示する
      const prevWhiteIndex = octave * 7 + WHITE_SEMITONES.indexOf(semitone - 1);
      blackKeys.push({
        midi,
        leftPercent: (prevWhiteIndex + 1) * whiteWidth - whiteWidth * 0.3,
      });
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <button onClick={() => shift(-1)} style={octaveButtonStyle}>
          − オクターブ
        </button>
        <span style={{ fontSize: 14 }}>
          表示範囲: {noteName(baseNote)} 〜 {noteName(baseNote + KEY_COUNT - 1)}
        </span>
        <button onClick={() => shift(1)} style={octaveButtonStyle}>
          + オクターブ
        </button>
      </div>

      <div
        style={{ position: "relative", height: 160, userSelect: "none", touchAction: "none" }}
      >
        {/* 白鍵 */}
        {whiteKeys.map(({ midi, whiteIndex }) => (
          <div
            key={midi}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              keyboard.noteOn(midi);
            }}
            onPointerUp={() => keyboard.noteOff(midi)}
            onPointerCancel={() => keyboard.noteOff(midi)}
            style={{
              position: "absolute",
              left: `${whiteIndex * whiteWidth}%`,
              width: `${whiteWidth}%`,
              height: "100%",
              background: pressed.has(midi) ? "#ffd54f" : "#fafafa",
              border: "1px solid #555",
              borderRadius: "0 0 4px 4px",
              color: "#333",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              alignItems: "center",
              paddingBottom: 4,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {/* 下のオクターブには PC キーの割当を表示 */}
            <span style={{ color: "#888" }}>
              {midi - baseNote <= 12 ? SEMITONE_TO_KEY_LABEL[midi - baseNote] : ""}
            </span>
            {midi % 12 === 0 && <span>{noteName(midi)}</span>}
          </div>
        ))}

        {/* 黒鍵(白鍵の上に重ねる) */}
        {blackKeys.map(({ midi, leftPercent }) => (
          <div
            key={midi}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              keyboard.noteOn(midi);
            }}
            onPointerUp={() => keyboard.noteOff(midi)}
            onPointerCancel={() => keyboard.noteOff(midi)}
            style={{
              position: "absolute",
              left: `${leftPercent}%`,
              width: `${whiteWidth * 0.6}%`,
              height: "60%",
              background: pressed.has(midi) ? "#ff8f00" : "#222",
              border: "1px solid #000",
              borderRadius: "0 0 3px 3px",
              zIndex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              alignItems: "center",
              paddingBottom: 4,
              fontSize: 10,
              color: "#bbb",
              cursor: "pointer",
            }}
          >
            {midi - baseNote <= 12 ? SEMITONE_TO_KEY_LABEL[midi - baseNote] : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

const octaveButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 14,
  background: "#3b3b52",
  color: "#eee",
  border: "1px solid #666",
  borderRadius: 6,
  cursor: "pointer",
};
