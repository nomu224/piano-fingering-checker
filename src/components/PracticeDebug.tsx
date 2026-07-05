// P1 用の最小動作確認画面
// テスト曲を読み込み、バーチャル MIDI の打鍵をスコアフォローに流して
// 「次に弾くべき音」と「直前の判定結果」を表示する。
// ※ S-04 練習画面の正式実装は P4。この画面は P1 完了条件
//   「バーチャル鍵盤でテスト曲を弾くと音の正誤が判定される」の確認用の仮画面。

import { useEffect, useRef, useState } from "react";
import { ScoreFollower } from "../core/scoreFollower";
import type { NoteOnResult } from "../core/types";
import { noteName, VirtualMidiKeyboard } from "../midi/virtualKeyboard";
import { doremi } from "../songs";
import { VirtualKeyboard } from "./VirtualKeyboard";

/** 判定結果 → 表示文言と色 */
function resultView(result: NoteOnResult): { text: string; color: string } {
  switch (result.type) {
    case "correct":
      return { text: "正解", color: "#4caf50" };
    case "wrongNote":
      return {
        text: `音ミス(${noteName(result.playedMidi)} を押しました)`,
        color: "#ef5350",
      };
    case "duplicateIgnored":
      return { text: "(無視: 達成済みの音)", color: "#9e9e9e" };
    case "skipJump":
      return {
        text: `弾き飛ばしを検出 → ${result.skippedEventIndices.length} 音スキップして先へ進みます`,
        color: "#ffb300",
      };
    case "finished":
      return { text: "演奏終了!おつかれさまでした", color: "#42a5f5" };
  }
}

export function PracticeDebug() {
  // クラスインスタンスは再レンダリングで作り直さないよう ref に保持する
  const keyboardRef = useRef<VirtualMidiKeyboard | null>(null);
  keyboardRef.current ??= new VirtualMidiKeyboard();
  const followerRef = useRef<ScoreFollower | null>(null);
  followerRef.current ??= new ScoreFollower(doremi);

  const [lastResult, setLastResult] = useState<NoteOnResult | null>(null);
  // スコアフォローの内部状態変更を画面に反映させるためのカウンタ
  const [, setVersion] = useState(0);

  // バーチャル MIDI の Note On を判定エンジンへ流す
  // (判定エンジンは入力源を区別しないため、P4 で実デバイスに差し替えても同じ流れになる)
  useEffect(() => {
    const keyboard = keyboardRef.current!;
    const follower = followerRef.current!;
    return keyboard.addNoteOnListener(({ note, timestampMs }) => {
      const result = follower.processNoteOn(note, timestampMs);
      setLastResult(result);
      setVersion((v) => v + 1);
    });
  }, []);

  const follower = followerRef.current;
  const song = follower.getSong();
  const finished = follower.isFinished();
  const current = follower.getCurrentEvent();
  const view = lastResult ? resultView(lastResult) : null;

  const restart = () => {
    follower.reset();
    setLastResult(null);
    setVersion((v) => v + 1);
  };

  return (
    <div>
      <h1 style={{ fontSize: 20 }}>ピアノ運指チェッカー(P1 動作確認画面)</h1>
      <p style={{ fontSize: 14, color: "#aaa" }}>
        曲: {song.title} / 進行: {finished ? song.events.length : follower.getCursor()} /{" "}
        {song.events.length}
      </p>

      {/* 次に弾くべき音(遠目でも分かる大きな表示) */}
      <div style={{ margin: "16px 0" }}>
        {finished ? (
          <div style={{ fontSize: 40, fontWeight: "bold", color: "#42a5f5" }}>
            演奏終了 🎉
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, color: "#aaa" }}>次に弾く音</div>
            <div style={{ fontSize: 48, fontWeight: "bold" }}>
              {current.notes.map((n) => (
                <span key={`${n.midi}-${n.hand}`} style={{ marginRight: 24 }}>
                  {noteName(n.midi)}
                  <span style={{ fontSize: 24, color: "#80cbc4" }}>
                    (指{n.finger ?? "指定なし"} / {n.hand === "R" ? "右手" : "左手"})
                  </span>
                </span>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "#777" }}>
              {current.measure} 小節目の {current.posInMeasure} 番目
            </div>
          </div>
        )}
      </div>

      {/* 直前の判定結果 */}
      <div
        style={{
          minHeight: 48,
          margin: "12px 0",
          fontSize: 28,
          fontWeight: "bold",
          color: view?.color ?? "#666",
        }}
      >
        {view?.text ?? "鍵盤を押すと判定が始まります"}
      </div>

      <button
        onClick={restart}
        style={{
          padding: "8px 16px",
          fontSize: 14,
          background: "#3b3b52",
          color: "#eee",
          border: "1px solid #666",
          borderRadius: 6,
          cursor: "pointer",
          marginBottom: 16,
        }}
      >
        最初からやり直す
      </button>

      <VirtualKeyboard keyboard={keyboardRef.current} />

      <p style={{ fontSize: 12, color: "#777", marginTop: 12 }}>
        PC キーボードでも弾けます(A=ド, S=レ, D=ミ, F=ファ, G=ソ ...)。詳しい割当は
        README を参照。
      </p>
    </div>
  );
}
