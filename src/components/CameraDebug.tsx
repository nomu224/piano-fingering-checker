// P2 動作確認画面: カメラ選択・プレビュー・ランドマーク描画(仕様書 F-01 カメラ部分 / 7.2 入力部分)
//
// - カメラの選択と getUserMedia によるプレビュー(useHandCamera フックに共通化)
// - MediaPipe Hands で両手 21 点を検出し、プレビューに重ねて描画
// - ミラー切替は CSS 変換で「表示だけ」反転する(F-01: 座標系に反転を持ち込まない。初期値は反転なし)
// - 検出した手の数・handedness・fps を表示(12 章: 認識状態のリアルタイム表示)
// ※ 正式なセットアップ画面 S-01 は後続フェーズ。これは P2 完了条件の確認用の仮画面。

import { useCallback, useRef, useState } from "react";
import type { LandmarkFrame } from "../core/types";
import { drawLandmarks } from "./drawLandmarks";
import { useHandCamera } from "./useHandCamera";

export function CameraDebug() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // ミラー(左右反転)。F-01 の指定によりデフォルトは反転なし
  const [mirror, setMirror] = useState(false);
  const [handsInfo, setHandsInfo] = useState("検出なし");

  /** 毎フレーム: ランドマーク描画と認識状態の更新 */
  const onFrame = useCallback((frame: LandmarkFrame, video: HTMLVideoElement) => {
    const canvas = canvasRef.current;
    if (canvas) drawLandmarks(canvas, video, frame);

    if (frame.hands.length === 0) {
      setHandsInfo("検出なし(手をカメラに映してください)");
    } else {
      const labels = frame.hands
        .map(
          (h) =>
            `${h.handedness === "L" ? "左手" : "右手"}(信頼度 ${(h.score * 100).toFixed(0)}%)`,
        )
        .join(" / ");
      setHandsInfo(`${frame.hands.length} 手検出: ${labels}`);
    }
  }, []);

  const {
    videoRef,
    state,
    errorMessage,
    devices,
    selectedDeviceId,
    startCamera,
    fps,
    delegate,
  } = useHandCamera(onFrame);

  return (
    <div>
      <h1 style={{ fontSize: 20 }}>カメラ確認(P2 動作確認画面)</h1>
      <p style={{ fontSize: 13, color: "#8bc34a" }}>
        カメラ映像は端末の外に一切送信されません(すべてブラウザ内で処理されます)。
      </p>

      {/* カメラ選択とミラー切替(F-01) */}
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
          <input
            type="checkbox"
            checked={mirror}
            onChange={(e) => setMirror(e.target.checked)}
          />{" "}
          左右反転(ミラー)表示
        </label>
      </div>

      {/* 認識状態(12 章) */}
      <p style={{ fontSize: 14 }}>
        認識状態: <strong>{handsInfo}</strong>
        {state === "running" && (
          <span style={{ color: "#aaa" }}>
            {" "}
            | 処理速度: {fps} fps | 実行方式: {delegate}
          </span>
        )}
      </p>

      {state === "error" && (
        <div style={{ background: "#4e2a2a", padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <p style={{ margin: "0 0 8px", color: "#ff8a80" }}>{errorMessage}</p>
          <button
            onClick={() => startCamera(selectedDeviceId)}
            style={{
              padding: "6px 16px",
              fontSize: 14,
              background: "#3b3b52",
              color: "#eee",
              border: "1px solid #666",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            再試行
          </button>
        </div>
      )}

      {state === "initializing" && (
        <p style={{ color: "#ffb300" }}>初期化中…(初回は手認識モデルの読み込みに数秒かかります)</p>
      )}

      {/* プレビュー + ランドマーク描画。ミラーは CSS で表示だけ反転(座標系は生映像基準のまま) */}
      <div
        style={{
          position: "relative",
          maxWidth: 640,
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
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        />
      </div>

      <p style={{ fontSize: 12, color: "#777", marginTop: 8 }}>
        両手をカメラに映すと、手ごとに 21 点のランドマークが描画されます(左手=水色 / 右手=オレンジ)。
        左右の表示が実際の手と逆の場合は開発者に報告してください(handedness の読み替え検証: 仕様書 7.2)。
      </p>
    </div>
  );
}
