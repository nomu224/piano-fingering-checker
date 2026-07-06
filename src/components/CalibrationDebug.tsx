// P3 動作確認画面: キャリブレーションウィザード(F-03 手順 1〜5)+ 指特定デバッグ(7.2)
//
// - ウィザードで「MIDI ノート番号 ⇔ 映像内の鍵盤 x 座標」の対応表を作る
// - 完了後は Note On ごとに指特定を実行し、推定指番号と信頼度を表示する
// - MIDI 入力は MidiSource インターフェース経由(バーチャル MIDI でも実デバイスでも同じ扱い)
// - キャリブレーション結果はメモリ内のみ(F-03: 保存しない)。
//   カメラ・ミラー切替時は破棄してウィザード先頭に戻す(F-03: 再キャリブレーション必須)
// ※ 運指判定(譜面との比較)は P4。ここでは対象の手をトグルで選ぶ。

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  CALIBRATION_MAX_DEVIATION_SEMITONES,
  CALIBRATION_RECOMMENDED_REF_DISTANCE,
} from "../core/constants";
import { estimateFinger, noteToX } from "../core/fingerEstimator";
import type {
  FingerEstimateResult,
  Hand,
  KeyboardCalibration,
  LandmarkFrame,
} from "../core/types";
import { noteName, VirtualMidiKeyboard } from "../midi/virtualKeyboard";
import {
  buildCalibration,
  deviationSemitones,
  findLowestFingertip,
  type ReferencePoint,
} from "../vision/calibration";
import { drawLandmarks } from "./drawLandmarks";
import { useHandCamera } from "./useHandCamera";
import { VirtualKeyboard } from "./VirtualKeyboard";

// ---- ウィザードの状態管理(純粋な reducer。Note On を受けてステップを進める) ----

type WizardStep = "setup" | "low" | "high" | "verify" | "done";

/** 確認ステップの 1 打鍵分の記録(deviation が null = 手未検出でズレ計算不能) */
interface VerifyCheck {
  midi: number;
  deviation: number | null;
}

/** 指特定デバッグの 1 打鍵分の記録 */
interface EstimationLogEntry {
  midi: number;
  hand: Hand;
  result: FingerEstimateResult;
}

/**
 * 直前の打鍵のプレビュー表示用マーカー(デバッグの見える化)。
 * kx = 押した音の推定鍵盤位置、tipX/tipY = 採用された指先(無ければ null)。
 */
interface NoteOnMark {
  kx: number;
  tipX: number | null;
  tipY: number | null;
}

/** 指先ランドマークの index(指番号 1〜5 に対応) */
const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;

interface WizardState {
  step: WizardStep;
  /** 低い方の基準鍵盤の記録(F-03 手順 2) */
  lowRef: ReferencePoint | null;
  calibration: KeyboardCalibration | null;
  /** 基準 2 鍵が 1 オクターブ未満だったときの警告(強制はしない) */
  refDistanceWarning: boolean;
  checks: VerifyCheck[];
  estimations: EstimationLogEntry[];
  /** ユーザーへの一時メッセージ(手が見えない・同じ鍵盤 など) */
  message: string;
  /** 指特定デバッグでの対象の手(本来は譜面 note の hand。P4 で接続) */
  targetHand: Hand;
  /** 直前の打鍵マーカー(プレビューに描画) */
  lastMark: NoteOnMark | null;
}

const INITIAL_STATE: WizardState = {
  step: "setup",
  lowRef: null,
  calibration: null,
  refDistanceWarning: false,
  checks: [],
  estimations: [],
  message: "",
  targetHand: "R",
  lastMark: null,
};

type WizardAction =
  | { type: "start" }
  | { type: "noteOn"; midi: number; frame: LandmarkFrame | null }
  | { type: "finishVerify" }
  | { type: "reset" }
  | { type: "setTargetHand"; hand: Hand };

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "start":
      return { ...INITIAL_STATE, targetHand: state.targetHand, step: "low" };
    case "reset":
      return { ...INITIAL_STATE, targetHand: state.targetHand };
    case "setTargetHand":
      return { ...state, targetHand: action.hand };
    case "finishVerify":
      if (state.step !== "verify") return state;
      return { ...state, step: "done", message: "" };
    case "noteOn":
      return handleNoteOn(state, action.midi, action.frame);
  }
}

/** Note On 1 回ぶんのウィザード処理(ステップごと) */
function handleNoteOn(
  state: WizardState,
  midi: number,
  frame: LandmarkFrame | null,
): WizardState {
  switch (state.step) {
    case "setup":
      return state; // 開始前の打鍵は無視

    // 手順 2: 低い方の基準鍵盤
    case "low": {
      const tip = frame ? findLowestFingertip(frame) : null;
      if (!tip) {
        return { ...state, message: "手が見えていません。鍵盤を押す手をカメラに映してください" };
      }
      return {
        ...state,
        lowRef: { midi, x: tip.x },
        step: "high",
        message: `${noteName(midi)} を記録しました`,
      };
    }

    // 手順 3: 高い方の基準鍵盤
    case "high": {
      const tip = frame ? findLowestFingertip(frame) : null;
      if (!tip) {
        return { ...state, message: "手が見えていません。鍵盤を押す手をカメラに映してください" };
      }
      const lowRef = state.lowRef!;
      if (midi === lowRef.midi) {
        return { ...state, message: "同じ鍵盤です。別の鍵盤を押してください" };
      }
      // 手順 4: 線形補間の対応表を作成
      const calibration = buildCalibration(lowRef, { midi, x: tip.x });
      return {
        ...state,
        calibration,
        refDistanceWarning:
          Math.abs(midi - lowRef.midi) < CALIBRATION_RECOMMENDED_REF_DISTANCE,
        step: "verify",
        message: `${noteName(midi)} を記録しました`,
      };
    }

    // 手順 5: 確認(ズレの表示)
    case "verify": {
      const tip = frame ? findLowestFingertip(frame) : null;
      // 手未検出の打鍵は「手未検出」として記録し、再キャリブレーション判定には含めない
      const deviation = tip
        ? deviationSemitones(state.calibration!, midi, tip.x)
        : null;
      return {
        ...state,
        checks: [{ midi, deviation }, ...state.checks].slice(0, 10),
        message: "",
        // 見える化: 押した音の推定位置と、ズレ計算に使った指先をプレビューに描く
        lastMark: {
          kx: noteToX(state.calibration!, midi),
          tipX: tip?.x ?? null,
          tipY: tip?.y ?? null,
        },
      };
    }

    // 完了後: 指特定デバッグ(Note On ごとに推定指番号と信頼度を表示)
    case "done": {
      const result = estimateFinger(frame, state.targetHand, midi, state.calibration!);
      // 見える化: 推定に採用された指先の座標を求める(判定不能のときは指先マーカーなし)
      let tipX: number | null = null;
      let tipY: number | null = null;
      if (result.status === "estimated" && frame) {
        const target = frame.hands
          .filter((h) => h.handedness === state.targetHand)
          .sort((a, b) => b.score - a.score)[0];
        const tip = target?.landmarks[FINGERTIP_INDICES[result.finger - 1]];
        tipX = tip?.x ?? null;
        tipY = tip?.y ?? null;
      }
      return {
        ...state,
        estimations: [
          { midi, hand: state.targetHand, result },
          ...state.estimations,
        ].slice(0, 10),
        lastMark: { kx: noteToX(state.calibration!, midi), tipX, tipY },
      };
    }
  }
}

/** 1 オクターブ内の白鍵の半音位置(鍵盤位置の白線描画用) */
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/**
 * キャリブレーション結果の見える化(デバッグ用オーバーレイ)。
 * - 白線: 各白鍵の推定位置(アプリが考えている鍵盤の場所)
 * - 黄線: 直前に押した音の推定位置 / 緑丸: そのとき採用された指先
 * ミラー表示時は canvas ごと CSS で反転されるため座標はそのままで良いが、
 * 文字だけは鏡文字になるので反転を打ち消して描く。
 */
function drawCalibrationOverlay(
  canvas: HTMLCanvasElement,
  calibration: KeyboardCalibration,
  mark: NoteOnMark | null,
  mirror: boolean,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();

  // 各白鍵の推定位置(画面内に入るものだけ)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 1;
  ctx.font = `${Math.max(12, Math.round(h * 0.035))}px sans-serif`;
  for (
    let midi = calibration.lowMidi - 24;
    midi <= calibration.highMidi + 24;
    midi++
  ) {
    if (!WHITE_SEMITONES.includes(midi % 12)) continue;
    const x = noteToX(calibration, midi);
    if (x < 0 || x > 1) continue;
    ctx.beginPath();
    ctx.moveTo(x * w, h * 0.55);
    ctx.lineTo(x * w, h);
    ctx.stroke();
    // ド(C)にだけ音名ラベルを付ける(ごちゃつき防止)
    if (midi % 12 === 0) {
      ctx.save();
      ctx.translate(x * w + 3, h * 0.6);
      if (mirror) ctx.scale(-1, 1); // 鏡文字の打ち消し
      ctx.fillText(noteName(midi), 0, 0);
      ctx.restore();
    }
  }

  // 直前の打鍵: 押した音の位置(黄)と採用された指先(緑)
  if (mark) {
    ctx.strokeStyle = "#ffee58";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mark.kx * w, 0);
    ctx.lineTo(mark.kx * w, h);
    ctx.stroke();
    if (mark.tipX !== null && mark.tipY !== null) {
      ctx.strokeStyle = "#76ff03";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(mark.tipX * w, mark.tipY * h, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 指特定結果の表示文言 */
function estimationText(entry: EstimationLogEntry): { text: string; color: string } {
  const name = noteName(entry.midi);
  const handLabel = entry.hand === "R" ? "右手" : "左手";
  const r = entry.result;
  if (r.status === "estimated") {
    return {
      text:
        `${name}(${handLabel}) → 指 ${r.finger} ` +
        `[距離 ${r.distanceSemitones.toFixed(2)} 半音 / 差 ${r.marginSemitones.toFixed(2)}` +
        `${r.usedYTieBreak ? " / y座標で判定" : ""}]`,
      color: "#4caf50",
    };
  }
  const reasons = {
    handNotDetected: "対象の手が検出されていません",
    tooFar: "どの指も鍵盤に十分近くありません",
    ambiguous: "指が拮抗していて判別できません",
  } as const;
  return { text: `${name}(${handLabel}) → 判定不能(${reasons[r.reason]})`, color: "#ef5350" };
}

// ---- 画面本体 ----

export function CalibrationDebug() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keyboardRef = useRef<VirtualMidiKeyboard | null>(null);
  keyboardRef.current ??= new VirtualMidiKeyboard();

  const [mirror, setMirror] = useState(false);
  const [wizard, dispatch] = useReducer(wizardReducer, INITIAL_STATE);

  // 毎フレームの描画コールバックから最新のウィザード状態・ミラー設定を参照するための ref
  const wizardRef = useRef(wizard);
  wizardRef.current = wizard;
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;

  const onFrame = useCallback((frame: LandmarkFrame, video: HTMLVideoElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawLandmarks(canvas, video, frame);
    // キャリブレーション済みなら鍵盤位置のオーバーレイも描く(デバッグの見える化)
    const w = wizardRef.current;
    if (w.calibration) {
      drawCalibrationOverlay(canvas, w.calibration, w.lastMark, mirrorRef.current);
    }
  }, []);

  const {
    videoRef,
    trackerRef,
    state: cameraState,
    errorMessage,
    devices,
    selectedDeviceId,
    startCamera,
    fps,
  } = useHandCamera(onFrame);

  // MIDI(MidiSource インターフェース)の Note On を購読。
  // リングバッファから Note On 時刻に最も近いフレームを取り出して渡す(仕様書 7.2 の重要注記)
  useEffect(() => {
    const keyboard = keyboardRef.current!;
    return keyboard.addNoteOnListener(({ note, timestampMs }) => {
      const frame =
        trackerRef.current?.history.getNearestFrame(timestampMs) ?? null;
      dispatch({ type: "noteOn", midi: note, frame });
    });
  }, [trackerRef]);

  // カメラ・ミラー切替でキャリブレーションを破棄(F-03: 再キャリブレーション必須)
  const isFirstRunRef = useRef(true);
  useEffect(() => {
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      return;
    }
    dispatch({ type: "reset" });
  }, [selectedDeviceId, mirror]);

  const needsRecalib = wizard.checks.some(
    (c) => c.deviation !== null && c.deviation > CALIBRATION_MAX_DEVIATION_SEMITONES,
  );

  /** ステップごとのガイド文(F-03 のウィザード形式) */
  const stepGuide: Record<WizardStep, string> = {
    setup:
      "手順1: 鍵盤全体がカメラに映るようにセッティングしてください(鍵盤が画面の下側になる向きで)。準備ができたら開始を押してください。",
    low: "手順2: 低い方の基準鍵盤を 1 つ押してください(どの鍵盤でも構いません。手順3の鍵盤と 1 オクターブ以上離してください)。",
    high: "手順3: 高い方の基準鍵盤を 1 つ押してください。",
    verify:
      "手順5: 確認です。映像に各鍵盤の推定位置(白線)が表示されます。白線の位置に指を置いて対応する音を押し、ズレが小さいことを確認してください。黄線=押した音の位置、緑丸=検出された指先です。問題なければ「キャリブレーション完了」を押してください。",
    done: "キャリブレーション完了。白線の鍵盤位置に指を置いて対応する音を押すと、押した指の推定結果が表示されます。",
  };

  return (
    <div>
      <h1 style={{ fontSize: 20 }}>キャリブレーション・指特定(P3 動作確認画面)</h1>

      {/* カメラ選択・ミラー(変更するとキャリブレーションはやり直し) */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <label style={{ fontSize: 14 }}>
          カメラ:{" "}
          <select
            value={selectedDeviceId}
            onChange={(e) => startCamera(e.target.value)}
            style={{ fontSize: 14, padding: 4 }}
          >
            {devices.length === 0 && <option value="">(権限許可後に一覧表示)</option>}
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `カメラ ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 14 }}>
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />{" "}
          左右反転(ミラー)表示
        </label>
        <span style={{ fontSize: 12, color: "#777" }}>
          ※ カメラ・ミラーを変更するとキャリブレーションはやり直しになります
        </span>
      </div>

      {cameraState === "error" && (
        <div style={{ background: "#4e2a2a", padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <p style={{ margin: "0 0 8px", color: "#ff8a80" }}>{errorMessage}</p>
          <button onClick={() => startCamera(selectedDeviceId)} style={buttonStyle}>
            再試行
          </button>
        </div>
      )}
      {cameraState === "initializing" && (
        <p style={{ color: "#ffb300" }}>初期化中…(初回は手認識モデルの読み込みに数秒かかります)</p>
      )}

      {/* ウィザードのガイド */}
      <div style={{ background: "#2a2a3e", padding: 12, borderRadius: 8, marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 16, fontWeight: "bold" }}>{stepGuide[wizard.step]}</p>
        {wizard.message && (
          <p style={{ margin: "8px 0 0", color: "#ffb300" }}>{wizard.message}</p>
        )}
        {wizard.refDistanceWarning && wizard.step === "verify" && (
          <p style={{ margin: "8px 0 0", color: "#ffb300" }}>
            基準の 2 鍵盤が 1 オクターブ未満しか離れていません。補間の精度が落ちる可能性があるため、やり直しを推奨します。
          </p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {wizard.step === "setup" && (
            <button onClick={() => dispatch({ type: "start" })} style={buttonStyle}>
              キャリブレーション開始
            </button>
          )}
          {wizard.step === "verify" && (
            <button onClick={() => dispatch({ type: "finishVerify" })} style={buttonStyle}>
              キャリブレーション完了 → 指特定デバッグへ
            </button>
          )}
          {wizard.step !== "setup" && (
            <button onClick={() => dispatch({ type: "reset" })} style={buttonStyle}>
              最初からやり直す
            </button>
          )}
        </div>
      </div>

      {/* 確認ステップ(手順5)のズレ一覧 */}
      {wizard.step === "verify" && (
        <div style={{ marginBottom: 12 }}>
          {needsRecalib && (
            <p style={{ color: "#ef5350", fontWeight: "bold" }}>
              ズレが {CALIBRATION_MAX_DEVIATION_SEMITONES} 半音を超えた打鍵があります(おおよそ隣の鍵盤と取り違えるレベル)。
              再キャリブレーションを推奨します。
            </p>
          )}
          <ul style={{ fontSize: 14, paddingLeft: 20, margin: 0 }}>
            {wizard.checks.map((c, i) => (
              <li
                key={i}
                style={{
                  color:
                    c.deviation === null
                      ? "#9e9e9e"
                      : c.deviation > CALIBRATION_MAX_DEVIATION_SEMITONES
                        ? "#ef5350"
                        : "#4caf50",
                }}
              >
                {noteName(c.midi)}:{" "}
                {c.deviation === null
                  ? "手未検出(ズレを計算できません)"
                  : `ズレ ${c.deviation.toFixed(2)} 半音`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 指特定デバッグ(完了後): Note On ごとの推定指番号と信頼度 */}
      {wizard.step === "done" && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 14 }}>
            判定対象の手(P4 で譜面の hand に接続予定):{" "}
            <select
              value={wizard.targetHand}
              onChange={(e) =>
                dispatch({ type: "setTargetHand", hand: e.target.value as Hand })
              }
              style={{ fontSize: 14, padding: 4 }}
            >
              <option value="R">右手</option>
              <option value="L">左手</option>
            </select>
          </label>
          {wizard.estimations.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              {/* 直前の結果は大きく表示 */}
              <div
                style={{
                  fontSize: 24,
                  fontWeight: "bold",
                  color: estimationText(wizard.estimations[0]).color,
                }}
              >
                {estimationText(wizard.estimations[0]).text}
              </div>
              <ul style={{ fontSize: 13, paddingLeft: 20, marginTop: 8, color: "#aaa" }}>
                {wizard.estimations.slice(1).map((e, i) => (
                  <li key={i}>{estimationText(e).text}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p style={{ fontSize: 14, color: "#aaa" }}>鍵盤を押してください</p>
          )}
        </div>
      )}

      {/* カメラプレビュー(ミラーは表示のみ反転) */}
      <div style={{ position: "relative", maxWidth: 640, transform: mirror ? "scaleX(-1)" : "none" }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", display: "block", borderRadius: 8 }} />
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      </div>
      <p style={{ fontSize: 12, color: "#777", margin: "4px 0 12px" }}>
        処理速度: {fps} fps | カメラ映像は端末の外に送信されません
      </p>

      {/* バーチャル MIDI(実キーボードが無くても動作確認できる) */}
      <VirtualKeyboard keyboard={keyboardRef.current} />
    </div>
  );
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
