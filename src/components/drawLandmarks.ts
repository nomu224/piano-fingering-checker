// 手ランドマーク・キャリブレーションオーバーレイのキャンバス描画
// (CameraDebug / CalibrationDebug / PracticeScreen で共用)
// 座標は常に生映像基準で描く(ミラー表示は CSS 変換で行い、座標系に反転を持ち込まない)。

import { noteToX } from "../core/fingerEstimator";
import type { KeyboardCalibration, LandmarkFrame } from "../core/types";
import { noteName } from "../midi/virtualKeyboard";

/** 手の骨格線(MediaPipe Hands の 21 点の接続関係) */
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], // 親指
  [0, 5], [5, 6], [6, 7], [7, 8], // 人差し指
  [5, 9], [9, 10], [10, 11], [11, 12], // 中指
  [9, 13], [13, 14], [14, 15], [15, 16], // 薬指
  [13, 17], [17, 18], [18, 19], [19, 20], // 小指
  [0, 17], // 手のひら
];

/** 手ごとの描画色(生映像基準の handedness で色分け) */
export const HAND_COLORS = { L: "#40c4ff", R: "#ff9100" } as const;

/**
 * ランドマークと骨格線をキャンバスに描画する。
 * canvas の内部解像度は video の実解像度に合わせる。
 */
export function drawLandmarks(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  frame: LandmarkFrame,
): void {
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const hand of frame.hands) {
    const color = HAND_COLORS[hand.handedness];
    // 骨格線
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = hand.landmarks[a];
      const pb = hand.landmarks[b];
      ctx.beginPath();
      ctx.moveTo(pa.x * canvas.width, pa.y * canvas.height);
      ctx.lineTo(pb.x * canvas.width, pb.y * canvas.height);
      ctx.stroke();
    }
    // ランドマーク点(指先 4,8,12,16,20 は大きめに)
    ctx.fillStyle = color;
    hand.landmarks.forEach((p, i) => {
      const isFingertip = i % 4 === 0 && i > 0;
      ctx.beginPath();
      ctx.arc(
        p.x * canvas.width,
        p.y * canvas.height,
        isFingertip ? 6 : 3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });
  }
}

// ---- キャリブレーション結果のオーバーレイ(デバッグ・練習画面の見える化) ----

/**
 * 直前の打鍵のプレビュー表示用マーカー。
 * kx = 押した音の推定鍵盤位置(不明なら null)、
 * tipX/tipY = 採用・記録された指先(無ければ null)。
 */
export interface NoteOnMark {
  kx: number | null;
  tipX: number | null;
  tipY: number | null;
}

/** 1 オクターブ内の白鍵の半音位置(鍵盤位置の白線描画用) */
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/**
 * キャリブレーション結果の見える化。
 * - 白線: 各白鍵の推定位置(アプリが考えている鍵盤の場所)
 * - 黄線: 直前に押した音の推定位置 / 緑丸: そのとき採用された指先
 * ミラー表示時は canvas ごと CSS で反転されるため座標はそのままで良いが、
 * 文字だけは鏡文字になるので反転を打ち消して描く。
 */
export function drawCalibrationOverlay(
  canvas: HTMLCanvasElement,
  calibration: KeyboardCalibration | null,
  mark: NoteOnMark | null,
  mirror: boolean,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();

  // 各白鍵の推定位置(キャリブレーション完了後のみ。画面内に入るものだけ)
  if (calibration) {
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
  }

  // 直前の打鍵: 押した音の位置(黄)と採用・記録された指先(緑)
  if (mark) {
    if (mark.kx !== null) {
      ctx.strokeStyle = "#ffee58";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(mark.kx * w, 0);
      ctx.lineTo(mark.kx * w, h);
      ctx.stroke();
    }
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
