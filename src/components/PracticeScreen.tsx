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
  PracticeSettings,
  Song,
} from "../core/types";
import type { NoteMessage } from "../midi/types";
import { noteName, VirtualMidiKeyboard } from "../midi/virtualKeyboard";
import { songs } from "../songs";
import {
  drawCalibrationOverlay,
  drawLandmarks,
  type NoteOnMark,
} from "./drawLandmarks";
import { MidiDeviceSelector } from "./MidiDeviceSelector";
import { ResultScreen } from "./ResultScreen";
import { SettingsModal } from "./SettingsModal";
import { useHandCamera } from "./useHandCamera";
import type { UseMidiDevices } from "./useMidiDevices";
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
  /** 練習の設定(F-07)。App が保持する */
  settings: PracticeSettings;
  onChangeSettings: (next: PracticeSettings) => void;
  /** MIDI デバイスの選択状態(F-01)。App が保持する */
  midi: UseMidiDevices;
}

export function PracticeScreen({
  calibrationInfo,
  settings,
  onChangeSettings,
  midi,
}: Props) {
  if (calibrationInfo) {
    return (
      <PracticeWithCamera
        info={calibrationInfo}
        settings={settings}
        onChangeSettings={onChangeSettings}
        midi={midi}
      />
    );
  }
  // カメラなし(音判定のみ)モード: F-01
  return (
    <PracticeCore
      calibration={null}
      getFrame={() => null}
      onMark={() => {}}
      settings={settings}
      onChangeSettings={onChangeSettings}
      midi={midi}
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
function PracticeWithCamera({
  info,
  settings,
  onChangeSettings,
  midi,
}: {
  info: CalibrationInfo;
  settings: PracticeSettings;
  onChangeSettings: (next: PracticeSettings) => void;
  midi: UseMidiDevices;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<NoteOnMark | null>(null);

  // ミラー(左右反転)表示。CSS で表示だけ反転し、座標系には反転を持ち込まない(F-01)。
  // 表示のみの変更なのでキャリブレーション・判定には影響しない
  const [mirror, setMirror] = useState(false);
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;

  const onFrame = useCallback(
    (frame: LandmarkFrame, video: HTMLVideoElement) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      drawLandmarks(canvas, video, frame);
      drawCalibrationOverlay(
        canvas,
        info.calibration,
        markRef.current,
        mirrorRef.current,
      );
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
      {state === "running" && (
        <label style={{ fontSize: 14, display: "inline-block", marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={mirror}
            onChange={(e) => setMirror(e.target.checked)}
          />{" "}
          左右反転(ミラー)表示
          <span style={{ fontSize: 12, color: "#777" }}>
            (表示だけ反転します。判定・キャリブレーションには影響しません)
          </span>
        </label>
      )}
      <div
        style={{
          position: "relative",
          maxWidth: 480,
          transform: mirror ? "scaleX(-1)" : "none",
        }}
      >
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
      settings={settings}
      onChangeSettings={onChangeSettings}
      midi={midi}
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
  /** 練習の設定(F-07) */
  settings: PracticeSettings;
  onChangeSettings: (next: PracticeSettings) => void;
  /** MIDI デバイスの選択状態(F-01) */
  midi: UseMidiDevices;
  /** カメラプレビュー or モード表示のバナー */
  cameraArea: ReactNode;
}

function PracticeCore({
  calibration,
  getFrame,
  onMark,
  settings,
  onChangeSettings,
  midi,
  cameraArea,
}: CoreProps) {
  const [song, setSong] = useState<Song>(songs[0]);

  // クラスインスタンスは ref に保持(再レンダリングで作り直さない)
  const keyboardRef = useRef<VirtualMidiKeyboard | null>(null);
  keyboardRef.current ??= new VirtualMidiKeyboard();
  const feedbackRef = useRef<FeedbackSound | null>(null);
  feedbackRef.current ??= new FeedbackSound();

  // 曲が変わったら判定エンジンを作り直す(現在の設定を引き継ぐ)
  const judgeRef = useRef<PracticeJudge | null>(null);
  const judgeSongRef = useRef<Song | null>(null);
  if (judgeRef.current === null || judgeSongRef.current !== song) {
    judgeRef.current = new PracticeJudge(song, {
      undeterminedAsMiss: settings.undeterminedAsMiss,
      targetHands: settings.targetHands,
    });
    judgeSongRef.current = song;
  }

  const [lastEntry, setLastEntry] = useState<JudgmentEntry | null>(null);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState("");
  const [measureInput, setMeasureInput] = useState("1");
  // 結果画面(S-05)の表示(完走で自動遷移 or 中断ボタン)
  const [showResult, setShowResult] = useState(false);
  // 設定モーダル(S-06)の表示
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const showResultRef = useRef(showResult);
  showResultRef.current = showResult;

  // 設定の変更を judge / feedback に即反映(セッションは切らない)
  useEffect(() => {
    judgeRef.current?.setUndeterminedAsMiss(settings.undeterminedAsMiss);
    judgeRef.current?.setTargetHands(settings.targetHands);
    feedbackRef.current?.setEnabled(settings.feedbackEnabled);
    feedbackRef.current?.setVolume(settings.feedbackVolume);
  }, [settings]);

  // Note On → 判定 → フィードバック音。
  // バーチャル鍵盤と実 MIDI デバイスの両方を購読する(仕様書 F-02: 判定側は入力源を区別しない)。
  // 実機を選んでいてもバーチャル鍵盤は使えるままにする(実機不調時の代替・テストのため)。
  const midiInput = midi.midiInput;
  useEffect(() => {
    const handleNoteOn = ({ note, timestampMs }: NoteMessage) => {
      // 一時停止中・結果/設定表示中の打鍵は無視(ログにも残さない)
      if (pausedRef.current || showResultRef.current) return;
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
      } else if (entry.feedback === "correct" && settingsRef.current.clickOnCorrect) {
        // 正解は既定で無音。設定 ON のときだけクリック音(F-05)
        feedbackRef.current!.click();
      }

      onMarkRef.current(buildMark(entry, frame, calib));
      setLastEntry(entry);
      setVersion((v) => v + 1);

      // 最終イベント達成 → 自動で結果画面へ(仕様書 7.1)
      if (entry.finished) {
        setShowResult(true);
      }
    };

    const offVirtual = keyboardRef.current!.addNoteOnListener(handleNoteOn);
    const offDevice = midiInput.addNoteOnListener(handleNoteOn);
    return () => {
      offVirtual();
      offDevice();
    };
  }, [midiInput]);

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
    setShowResult(false);
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

      {/* MIDI 機器の選択(F-01) */}
      <MidiDeviceSelector midi={midi} />

      {/* 横画面ではカメラ(左)と情報(右)を左右に並べる。縦画面では従来どおり縦積み */}
      <div className="practice-top">
        <div className="practice-cam">{cameraArea}</div>
        <div className="practice-info">

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
        </div>
      </div>

      {/* 操作(F-05: 一時停止 / やり直し / 小節指定開始)+ 結果・設定 */}
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
        <button onClick={() => setShowResult(true)} style={buttonStyle}>
          練習を終了して結果を見る
        </button>
        <button onClick={() => setSettingsOpen(true)} style={buttonStyle}>
          ⚙ 設定
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

      {/* 結果サマリー S-05(オーバーレイ表示。judge・カメラは生きたまま) */}
      {showResult && (
        <ResultScreen
          song={song}
          counts={counts}
          log={judge.getLog()}
          settings={settings}
          finished={finished}
          onRetry={restart}
          onClose={() => setShowResult(false)}
        />
      )}

      {/* 設定モーダル S-06 */}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onChange={onChangeSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
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
