// S-05 結果サマリー(仕様書 F-06)
//
// - 曲(または中断)終了後に表示(演奏終了時は自動遷移: 仕様書 7.1)
// - 総打鍵数・音ミス数・運指ミス数・判定不能数
// - 譜面位置ごとのミス一覧(「◯小節目の◯番目の音: 3 の指のところを 2 で弾いた」)
// - 判定ログの JSON ダウンロード(卒業論文の精度評価実験でデータとして使う)
// 練習画面(PracticeCore)の上に重ねて表示し、判定ログ・カメラは生かしたままにする。

import type {
  JudgmentCounts,
  JudgmentEntry,
  PracticeSettings,
  Song,
} from "../core/types";
import { noteName } from "../midi/virtualKeyboard";

interface Props {
  song: Song;
  counts: Readonly<JudgmentCounts>;
  log: readonly JudgmentEntry[];
  /** ダウンロード JSON に含める設定のスナップショット(実験条件の記録) */
  settings: PracticeSettings;
  /** 完走したか(true)/ 中断か(false) */
  finished: boolean;
  /** もう一度練習する(新しいセッションで練習画面へ) */
  onRetry: () => void;
  /** 練習画面へ戻る(セッションはそのまま) */
  onClose: () => void;
}

/** 譜面位置の表示(F-06 の文言) */
function positionText(measure: number, posInMeasure: number): string {
  return `${measure} 小節目の ${posInMeasure} 番目の音`;
}

/** 判定ログから譜面位置ごとのミス一覧を作る(F-06) */
function buildMissList(song: Song, log: readonly JudgmentEntry[]): string[] {
  const items: string[] = [];
  for (const e of log) {
    const pos = positionText(e.measure, e.posInMeasure);
    const s = e.soundResult;

    // 音ミス
    if (s.type === "wrongNote") {
      const expected = e.expectedNotes.map((n) => noteName(n.midi)).join("+");
      items.push(`${pos}: ${expected} のところを ${noteName(e.playedMidi)} を押した(音ミス)`);
    }

    // 弾き飛ばし救済(音ミス扱い)とスキップされた未演奏イベント
    const skippedIndices =
      s.type === "skipJump"
        ? s.skippedEventIndices
        : s.type === "finished"
          ? (s.skippedEventIndices ?? null)
          : null;
    if (skippedIndices) {
      items.push(`${pos}: 弾き飛ばしを検出(音ミス扱い)`);
      for (const idx of skippedIndices) {
        const ev = song.events[idx];
        items.push(`${positionText(ev.measure, ev.posInMeasure)}: スキップ(未演奏)`);
      }
    }

    // 運指ミス(F-06 の文言どおり)
    const f = e.fingering;
    if (f.kind === "miss") {
      items.push(
        `${pos}: ${f.expectedFinger} の指のところを ${f.estimated.finger} で弾いた(運指ミス)`,
      );
    }
    if (f.kind === "undetermined" && f.treatedAsMiss) {
      items.push(`${pos}: 指を特定できませんでした(設定によりミス扱い)`);
    }
  }
  return items;
}

export function ResultScreen({
  song,
  counts,
  log,
  settings,
  finished,
  onRetry,
  onClose,
}: Props) {
  const missList = buildMissList(song, log);

  /** 判定ログの JSON ダウンロード(F-06。卒論の精度評価実験用) */
  const downloadJson = () => {
    const data = {
      songId: song.id,
      songTitle: song.title,
      exportedAt: new Date().toISOString(),
      finished,
      settings,
      counts,
      log,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replaceAll(":", "-")
      .replace("T", "_");
    a.download = `practice-log_${song.id}_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        overflowY: "auto",
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        style={{
          background: "#2a2a3e",
          borderRadius: 12,
          padding: 20,
          maxWidth: 640,
          width: "100%",
        }}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>
          結果サマリー(S-05){finished ? "" : " — 中断"}
        </h2>
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "#aaa" }}>曲: {song.title}</p>

        {/* 集計(F-06) */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          {[
            ["総打鍵数", counts.totalNoteOns, "#eee"],
            ["音ミス", counts.noteMisses, "#ef5350"],
            ["運指ミス", counts.fingerMisses, "#ff7043"],
            ["判定不能", counts.undetermined, "#9e9e9e"],
          ].map(([label, value, color]) => (
            <div key={label as string} style={{ textAlign: "center", minWidth: 80 }}>
              <div style={{ fontSize: 13, color: "#aaa" }}>{label}</div>
              <div style={{ fontSize: 32, fontWeight: "bold", color: color as string }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* 譜面位置ごとのミス一覧(F-06) */}
        <h3 style={{ fontSize: 16, margin: "0 0 4px" }}>ミス一覧</h3>
        {missList.length === 0 ? (
          <p style={{ fontSize: 14, color: "#8bc34a" }}>ミスはありませんでした 🎉</p>
        ) : (
          <ul
            style={{
              fontSize: 14,
              paddingLeft: 20,
              margin: "0 0 12px",
              maxHeight: 240,
              overflowY: "auto",
            }}
          >
            {missList.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button onClick={downloadJson} style={buttonStyle}>
            判定ログを JSON でダウンロード
          </button>
          <button onClick={onRetry} style={{ ...buttonStyle, background: "#5c6bc0" }}>
            もう一度練習する
          </button>
          <button onClick={onClose} style={buttonStyle}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: 14,
  background: "#3b3b52",
  color: "#eee",
  border: "1px solid #666",
  borderRadius: 6,
  cursor: "pointer",
};
