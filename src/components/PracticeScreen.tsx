// S-04 練習画面(仕様書 F-05)
//
// - 進行位置(次に弾くべき音と指番号)の大きな表示(9 章: 画面を見なくても使える視認性優先)
// - 打鍵ごとのリアルタイム判定: 運指ミス=ビープ A +「指番号: 正解 X / 実際 Y」、音ミス=ビープ B、正解=無音
// - 一時停止 / 最初からやり直し / 小節番号を指定して途中から開始
// - 判定ログの記録(JSON ダウンロードは F-06 / P5)
// - カメラプレビュー + ランドマーク + 鍵盤白線オーバーレイ
// - キャリブレーション未実施なら「音判定のみモード」(F-01)として動く
//
// Note On 時のフレームはリングバッファの getNearestFrame(打鍵時刻に最も近いフレーム)を
// 使う(仕様書 7.2 の重要注記)。判定は Note On ハンドラ内で同期実行し、その場でビープを
// 鳴らすため、フィードバックまで 200ms 以内(10 章)を満たす。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FeedbackSound } from "../audio/feedback";
import { noteToX } from "../core/fingerEstimator";
import { PracticeJudge } from "../core/judge";
import type {
  JudgmentEntry,
  KeyboardCalibration,
  LandmarkFrame,
  Song,
} from "../core/types";
import { noteName, VirtualMidiKeyboard } from "../midi/virtualKeyboard";
import { songs } from "../songs";
import {
  drawCalibrationOverlay,
  drawLandmarks,
  type NoteOnMark,
} from "./drawLandmarks";
import { useHandCamera } from "./useHandCamera";
import { VirtualKeyboard } from "./VirtualKeyboard";

/** キャリブレーション結果と、それを取ったカメラ(App が保持し P3 → P4 へ受け渡す) */
export interface CalibrationInfo {
  calibration: KeyboardCalibration;
  deviceId: string;
}

/** 指先ランドマークの index(指番号 1〜5 に対応) */
const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;

interface Props {
  calibrationInfo: CalibrationInfo | null;
}

export function PracticeScreen({ calibrationInfo }: Props) {
  if (calibrationInfo) {
    return <PracticeWithCamera info={calibrationInfo} />;
  }
  // カメラなし(音判定のみ)モード: F-01
  return (
    <PracticeCore
      calibration={null}
      getFrame={() => null}
      onMark={() => {}}
      cameraArea={
        <div style={{ background: "#3e3a26", padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <strong style={{ color: "#ffd54f" }}>音判定のみモードで練習中</strong>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#ccc" }}>
            キャリブレーションが未実施のため、運指(指遣い)の判定は行いません。
            「P3: キャリブレーション・指特定」タブでキャリブレーションを完了すると、運指判定が有効になります。
          </p>
        </div>
      }
    />
  );
}

/** カメラあり(運指判定つき)の練習。キャリブレーション時と同じカメラを使う */
function PracticeWithCamera({ info }: { info: CalibrationInfo }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<NoteOnMark | null>(null);

  const onFrame = useCallback(
    (frame: LandmarkFrame, video: HTMLVideoElement) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      drawLandmarks(canvas, video, frame);
      drawCalibrationOverlay(canvas, info.calibration, markRef.current, false);
    },
    [info.calibration],
  );

  const { videoRef, trackerRef, state, errorMessage, startCamera, fps } =
    useHandCamera(onFrame, info.deviceId);

  const getFrame = useCallback(
    // Note On の時刻に最も近いフレームをリングバッファから取る(仕様書 7.2)
    (timestampMs: number) =>
      trackerRef.current?.history.getNearestFrame(timestampMs) ?? null,
    [trackerRef],
  );

  const cameraArea = (
    <div style={{ marginBottom: 12 }}>
      {state === "error" && (
        <div style={{ background: "#4e2a2a", padding: 12, borderRadius: 8, marginBottom: 8 }}>
          <p style={{ margin: 0, color: "#ff8a80" }}>
            {errorMessage}
            <br />
            カメラが使えない間は<strong>音判定のみ</strong>で練習できます。カメラ環境が変わった場合は
            「P3: キャリブレーション・指特定」タブで<strong>再キャリブレーション</strong>してください(F-03)。
          </p>
          <button onClick={() => startCamera(info.deviceId)} style={buttonStyle}>
            カメラを再試行
          </button>
        </div>
      )}
      {state === "initializing" && (
        <p style={{ color: "#ffb300" }}>カメラ初期化中…(手認識モデルの読み込みに数秒かかります)</p>
      )}
      <div style={{ position: "relative", maxWidth: 480 }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: "100%", display: "block", borderRadius: 8 }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      </div>
      {state === "running" && (
        <p style={{ fontSize: 12, color: "#777", margin: "4px 0 0" }}>
          処理速度: {fps} fps | 白線=鍵盤の推定位置 / 黄線=押した音 / 緑丸=推定に使った指先 |
          カメラ映像は端末の外に送信されません
        </p>
      )}
    </div>
  );

  return (
    <PracticeCore
      // カメラが動いていない間は運指判定を行わない(音判定のみに降格)
      calibration={state === "running" ? info.calibration : null}
      getFrame={getFrame}
      onMark={(m) => {
        markRef.current = m;
      }}
      cameraArea={cameraArea}
    />
  );
}

// ---- 練習画面の本体(カメラの有無に依存しない部分) ----

interface CoreProps {
  /** null = 音判定のみモード(運指判定なし) */
  calibration: KeyboardCalibration | null;
  /** Note On 時刻に最も近いフレームを返す(カメラなしなら null を返す関数) */
  getFrame: (timestampMs: number) => LandmarkFrame | null;
  /** 打鍵マーカーの通知(カメラプレビューのオーバーレイ用) */
  onMark: (mark: NoteOnMark | null) => void;
  /** カメラプレビュー or モード表示のバナー */
  cameraArea: ReactNode;
}

function PracticeCore({ calibration, getFrame, onMark, cameraArea }: CoreProps) {
  const [song, setSong] = useState<Song>(songs[0]);

  // クラスインスタンスは ref に保持(再レンダリングで作り直さない)
  const keyboardRef = useRef<VirtualMidiKeyboard | null>(null);
  keyboardRef.current ??= new VirtualMidiKeyboard();
  const feedbackRef = useRef<FeedbackSound | null>(null);
  feedbackRef.current ??= new FeedbackSound();

  // 曲が変わったら判定エンジンを作り直す
  const judgeRef = useRef<PracticeJudge | null>(null);
  const judgeSongRef = useRef<Song | null>(null);
  if (judgeRef.current === null || judgeSongRef.current !== song) {
    judgeRef.current = new PracticeJudge(song);
    judgeSongRef.current = song;
  }

  const [lastEntry, setLastEntry] = useState<JudgmentEntry | null>(null);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState("");
  const [measureInput, setMeasureInput] = useState("1");
  // 判定エンジンの内部状態変更を画面に反映させるためのカウンタ
  const [, setVersion] = useState(0);

  // Note On ハンドラから最新の props/state を参照するための ref
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const calibrationRef = useRef(calibration);
  calibrationRef.current = calibration;
  const getFrameRef = useRef(getFrame);
  getFrameRef.current = getFrame;
  const onMarkRef = useRef(onMark);
  onMarkRef.current = onMark;

  // MIDI(MidiSource)の Note On → 判定 → フィードバック音
  useEffect(() => {
    const keyboard = keyboardRef.current!;
    return keyboard.addNoteOnListener(({ note, timestampMs }) => {
      // 一時停止中の打鍵は無視(ログにも残さない)
      if (pausedRef.current) return;
      const judge = judgeRef.current!;
      // 演奏終了後の打鍵はセッションに含めない(やり直しで新セッション開始)
      if (judge.isFinished()) return;

      const calib = calibrationRef.current;
      const frame = calib ? getFrameRef.current(timestampMs) : null;
      const entry = judge.handleNoteOn(note, timestampMs, frame, calib);

      // フィードバック音(F-05)。判定は同期なので Note On から 200ms 以内(10 章)
      if (entry.feedback === "noteMiss") {
        feedbackRef.current!.noteMiss();
      } else if (entry.feedback === "fingerMiss") {
        feedbackRef.current!.fingerMiss();
      }

      onMarkRef.current(buildMark(entry, frame, calib));
      setLastEntry(entry);
      setVersion((v) => v + 1);
    });
  }, []);

  // 画面離脱時に AudioContext を解放
  useEffect(() => {
    const feedback = feedbackRef.current;
    return () => feedback?.close();
  }, []);

  const judge = judgeRef.current;
  const finished = judge.isFinished();
  const current = judge.getCurrentEvent();
  const counts = judge.getCounts();
  const view = lastEntry ? judgmentView(lastEntry) : null;

  const restart = () => {
    judge.restart();
    setLastEntry(null);
    setMessage("");
    setPaused(false);
    onMark(null);
    setVersion((v) => v + 1);
  };

  const startFromMeasure = () => {
    const measure = Number(measureInput);
    if (!Number.isInteger(measure) || !judge.startFromMeasure(measure)) {
      setMessage(`小節 ${measureInput} はこの曲にありません`);
      return;
    }
    setLastEntry(null);
    setMessage(`${measure} 小節目から開始します`);
    setPaused(false);
    onMark(null);
    setVersion((v) => v + 1);
  };

  return (
    <div>
      <h1 style={{ fontSize: 20 }}>練習(S-04)</h1>

      {/* 曲選択(正式な楽曲選択画面 S-03 は P5) */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <label style={{ fontSize: 14 }}>
          曲:{" "}
          <select
            value={song.id}
            onChange={(e) => {
              const next = songs.find((s) => s.id === e.target.value);
              if (next) {
                setSong(next);
                setLastEntry(null);
                setMessage("");
                setPaused(false);
                onMark(null);
              }
            }}
            style={{ fontSize: 14, padding: 4 }}
          >
            {songs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: 13, color: "#aaa" }}>
          打鍵 {counts.totalNoteOns} / 音ミス {counts.noteMisses} / 運指ミス {counts.fingerMisses} / 判定不能{" "}
          {counts.undetermined}
        </span>
      </div>

      {cameraArea}

      {/* 進行位置(遠目でも分かる大きな表示) */}
      <div style={{ margin: "8px 0" }}>
        {finished ? (
          <div style={{ fontSize: 40, fontWeight: "bold", color: "#42a5f5" }}>
            演奏終了 🎉(結果画面 S-05 は P5 で実装)
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, color: "#aaa" }}>
              次に弾く音({judge.getCursor() + 1} / {song.events.length}
              {paused ? "・一時停止中" : ""})
            </div>
            <div style={{ fontSize: 44, fontWeight: "bold", opacity: paused ? 0.4 : 1 }}>
              {current.notes.map((n) => (
                <span key={`${n.midi}-${n.hand}`} style={{ marginRight: 24 }}>
                  {noteName(n.midi)}
                  <span style={{ fontSize: 22, color: "#80cbc4" }}>
                    (指{n.finger ?? "-"} / {n.hand === "R" ? "右" : "左"})
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
          minHeight: 44,
          margin: "8px 0",
          fontSize: 26,
          fontWeight: "bold",
          color: view?.color ?? "#666",
        }}
      >
        {view?.text ?? "鍵盤を押すと判定が始まります"}
      </div>

      {/* 操作(F-05: 一時停止 / やり直し / 小節指定開始) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <button onClick={() => setPaused((p) => !p)} style={buttonStyle} disabled={finished}>
          {paused ? "再開" : "一時停止"}
        </button>
        <button onClick={restart} style={buttonStyle}>
          最初からやり直す
        </button>
        <label style={{ fontSize: 14 }}>
          <input
            type="number"
            min={1}
            value={measureInput}
            onChange={(e) => setMeasureInput(e.target.value)}
            style={{ width: 60, fontSize: 14, padding: 4 }}
          />{" "}
          小節目から
        </label>
        <button onClick={startFromMeasure} style={buttonStyle}>
          開始
        </button>
        {message && <span style={{ color: "#ffb300", fontSize: 14 }}>{message}</span>}
      </div>

      {/* 判定ログ(直近分。全ログはメモリ保持、JSON ダウンロードは P5) */}
      {judge.getLog().length > 0 && (
        <details style={{ fontSize: 13, color: "#aaa", marginBottom: 8 }}>
          <summary>判定ログ(直近 {Math.min(8, judge.getLog().length)} 件 / 全 {judge.getLog().length} 件)</summary>
          <ul style={{ paddingLeft: 20, margin: "4px 0" }}>
            {judge
              .getLog()
              .slice(-8)
              .reverse()
              .map((e, i) => (
                <li key={i} style={{ color: judgmentView(e).color }}>
                  [{e.measure}小節-{e.posInMeasure}] {noteName(e.playedMidi)}: {judgmentView(e).text}
                </li>
              ))}
          </ul>
        </details>
      )}

      {/* バーチャル MIDI(実キーボードが無い間の入力手段) */}
      <VirtualKeyboard keyboard={keyboardRef.current} />
    </div>
  );
}

/** 打鍵マーカー(カメラオーバーレイ用): 押した音の位置と、推定に使われた指先 */
function buildMark(
  entry: JudgmentEntry,
  frame: LandmarkFrame | null,
  calibration: KeyboardCalibration | null,
): NoteOnMark | null {
  if (!calibration) return null;
  const kx = noteToX(calibration, entry.playedMidi);
  let tipX: number | null = null;
  let tipY: number | null = null;

  const f = entry.fingering;
  const s = entry.soundResult;
  if (
    (f.kind === "ok" || f.kind === "miss") &&
    frame &&
    (s.type === "correct" || s.type === "finished")
  ) {
    const target = frame.hands
      .filter((h) => h.handedness === s.note.hand)
      .sort((a, b) => b.score - a.score)[0];
    const tip = target?.landmarks[FINGERTIP_INDICES[f.estimated.finger - 1]];
    if (tip) {
      tipX = tip.x;
      tipY = tip.y;
    }
  }
  return { kx, tipX, tipY };
}

/** 判定結果の表示文言と色(F-05) */
function judgmentView(entry: JudgmentEntry): { text: string; color: string } {
  const s = entry.soundResult;
  switch (s.type) {
    case "wrongNote":
      return { text: `音ミス(${noteName(entry.playedMidi)} を押しました)`, color: "#ef5350" };
    case "skipJump":
      return {
        text: `弾き飛ばしを検出 → ${s.skippedEventIndices.length} 音スキップして先へ(音ミス扱い)`,
        color: "#ffb300",
      };
    case "duplicateIgnored":
      return { text: "(無視: 達成済みの音)", color: "#9e9e9e" };
    case "correct":
    case "finished": {
      if (s.type === "finished" && s.skippedEventIndices) {
        return { text: "弾き飛ばしで最後まで到達(音ミス扱い)", color: "#ffb300" };
      }
      const f = entry.fingering;
      switch (f.kind) {
        case "ok":
          return { text: `正解(指 ${f.estimated.finger})`, color: "#4caf50" };
        case "miss":
          // F-05 指定の表示形式
          return {
            text: `運指ミス 指番号: 正解 ${f.expectedFinger} / 実際 ${f.estimated.finger}`,
            color: "#ff7043",
          };
        case "undetermined":
          return f.treatedAsMiss
            ? { text: "指の判定不能(ミス扱い)", color: "#ff7043" }
            : { text: "音は正解(指は判定不能のため記録のみ)", color: "#9ccc65" };
        case "skipped":
          return f.reason === "noFinger"
            ? { text: "正解(この音は譜面に指番号なし)", color: "#4caf50" }
            : { text: "正解(音のみ判定)", color: "#4caf50" };
        case "notApplicable":
          return { text: "正解", color: "#4caf50" };
      }
    }
  }
}

const buttonStyle: React.CSSProperties = {
  padding: "6px 16px",
  fontSize: 14,
  background: "#3b3b52",
  color: "#eee",
  border: "1px solid #666",
  borderRadius: 6,
  cursor: "pointer",
};
