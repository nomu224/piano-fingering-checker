// 手ランドマークのキャンバス描画(CameraDebug / CalibrationDebug で共用)
// 座標は常に生映像基準で描く(ミラー表示は CSS 変換で行い、座標系に反転を持ち込まない)。

import type { LandmarkFrame } from "../core/types";

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
