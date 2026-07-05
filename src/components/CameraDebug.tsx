// P2 動作確認画面: カメラ選択・プレビュー・ランドマーク描画(仕様書 F-01 カメラ部分 / 7.2 入力部分)
//
// - カメラの選択と getUserMedia によるプレビュー
// - MediaPipe Hands で両手 21 点を検出し、プレビューに重ねて描画
// - ミラー切替は CSS 変換で「表示だけ」反転する(F-01: 座標系に反転を持ち込まない。初期値は反転なし)
// - 検出した手の数・handedness・fps を表示(12 章: 認識状態のリアルタイム表示)
// ※ 正式なセットアップ画面 S-01 は後続フェーズ。これは P2 完了条件の確認用の仮画面。

import { useCallback, useEffect, useRef, useState } from "react";
import type { LandmarkFrame } from "../core/types";
import { HandTracker } from "../vision/handTracker";

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
const HAND_COLORS = { L: "#40c4ff", R: "#ff9100" } as const;

/** カメラ解像度(まずは控えめな値。解像度設定 UI は P5 で対応) */
const VIDEO_CONSTRAINTS = { width: { ideal: 640 }, height: { ideal: 480 } };

type CameraState = "initializing" | "running" | "error";

export function CameraDebug() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  // fps 計測用(直近 1 秒間の検出回数)
  const fpsCounterRef = useRef({ frames: 0, since: 0 });

  const [state, setState] = useState<CameraState>("initializing");
  const [errorMessage, setErrorMessage] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  // ミラー(左右反転)。F-01 の指定によりデフォルトは反転なし
  const [mirror, setMirror] = useState(false);
  const [fps, setFps] = useState(0);
  const [handsInfo, setHandsInfo] = useState<string>("検出なし");
  const [delegate, setDelegate] = useState<string>("");

  /** getUserMedia のエラーを日本語メッセージに変換する(10 章: 分かりやすいエラー) */
  const toErrorMessage = (e: unknown): string => {
    if (e instanceof DOMException) {
      if (e.name === "NotAllowedError") {
        return "カメラの使用が許可されていません。ブラウザのアドレスバーのカメラアイコンから許可して、再試行してください。";
      }
      if (e.name === "NotFoundError" || e.name === "OverconstrainedError") {
        return "カメラが見つかりません。Web カメラを接続するか、スマホの Web カメラ化アプリを起動してから再試行してください。";
      }
      if (e.name === "NotReadableError") {
        return "カメラを起動できません。他のアプリがカメラを使用中の可能性があります。";
      }
    }
    return `カメラの起動に失敗しました: ${String(e)}`;
  };

  /** カメラを起動する(切替時は旧ストリームを必ず停止してから) */
  const startCamera = useCallback(async (deviceId: string) => {
    setState("initializing");
    setErrorMessage("");
    try {
      // 旧ストリームの停止(カメラ LED 点きっぱなし・新デバイス取得失敗の防止)
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { ...VIDEO_CONSTRAINTS, deviceId: { exact: deviceId } }
          : VIDEO_CONSTRAINTS,
      });
      streamRef.current = stream;

      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      // カメラが変わったら座標系が変わるため履歴を破棄(F-03 の再キャリブレーション方針と同じ考え方)
      trackerRef.current?.history.clear();

      // 権限取得後はデバイスのラベルが見えるようになるので一覧を更新する
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "videoinput"));
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      if (settings.deviceId) setSelectedDeviceId(settings.deviceId);

      setState("running");
    } catch (e) {
      setState("error");
      setErrorMessage(toErrorMessage(e));
    }
  }, []);

  // 初期化: MediaPipe の読み込みとカメラ起動
  useEffect(() => {
    let cancelled = false;
    const tracker = new HandTracker();
    trackerRef.current = tracker;

    (async () => {
      try {
        await tracker.init(); // モデル読み込み(初回は数秒かかる)
        if (cancelled) return;
        setDelegate(tracker.getDelegateUsed() ?? "");
        await startCamera("");
      } catch (e) {
        if (!cancelled) {
          setState("error");
          setErrorMessage(`手認識モデルの読み込みに失敗しました: ${String(e)}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      tracker.close();
      trackerRef.current = null;
    };
  }, [startCamera]);

  // 検出ループ(requestAnimationFrame)。fps が落ちても判定は Note On 駆動なので破綻しない設計(10 章)
  useEffect(() => {
    if (state !== "running") return;

    const loop = () => {
      const video = videoRef.current;
      const tracker = trackerRef.current;
      if (video && tracker?.isReady() && video.readyState >= 2) {
        const frame = tracker.detect(video, performance.now());
        drawFrame(frame);
        updateStats(frame);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /** ランドマークと骨格線をキャンバスに描画する(座標は常に生映像基準) */
  const drawFrame = (frame: LandmarkFrame) => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext("2d")!;
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
  };

  /** 認識状態と fps の表示を更新する(12 章) */
  const updateStats = (frame: LandmarkFrame) => {
    const c = fpsCounterRef.current;
    c.frames++;
    const now = performance.now();
    if (now - c.since >= 1000) {
      setFps(c.frames);
      c.frames = 0;
      c.since = now;
    }
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
  };

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
