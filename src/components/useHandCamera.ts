// カメラ + MediaPipe 手認識の共通フック
// CameraDebug(P2)と CalibrationDebug(P3)で共用する。
// カメラ起動・デバイス列挙・HandTracker 初期化・毎フレーム検出ループ・fps 計測を担う。

import { useCallback, useEffect, useRef, useState } from "react";
import type { LandmarkFrame } from "../core/types";
import { HandTracker } from "../vision/handTracker";

/** カメラ解像度(まずは控えめな値。解像度設定 UI は P5 で対応) */
const VIDEO_CONSTRAINTS = { width: { ideal: 640 }, height: { ideal: 480 } };

export type CameraState = "initializing" | "running" | "error";

/** getUserMedia のエラーを日本語メッセージに変換する(仕様書 10 章: 分かりやすいエラー) */
function toErrorMessage(e: unknown): string {
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
}

export function useHandCamera(
  onFrame: (frame: LandmarkFrame, video: HTMLVideoElement) => void,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  // 毎フレームのコールバック(再レンダリングでループを張り直さないよう ref 経由で呼ぶ)
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  // fps 計測用(直近 1 秒間の検出回数)
  const fpsCounterRef = useRef({ frames: 0, since: 0 });

  const [state, setState] = useState<CameraState>("initializing");
  const [errorMessage, setErrorMessage] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [fps, setFps] = useState(0);
  const [delegate, setDelegate] = useState("");

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

      // カメラが変わったら座標系が変わるため履歴を破棄
      trackerRef.current?.history.clear();

      // 権限取得後はデバイスのラベルが見えるようになるので一覧を更新する
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "videoinput"));
      const settings = stream.getVideoTracks()[0]?.getSettings();
      if (settings?.deviceId) setSelectedDeviceId(settings.deviceId);

      setState("running");
    } catch (e) {
      setState("error");
      setErrorMessage(toErrorMessage(e));
      // 起動に失敗しても、別のカメラを選び直せるように一覧だけは更新を試みる
      // (例: iVCam などの仮想カメラが既定になっていて応答しない場合、
      //  ここで一覧が出れば内蔵カメラに切り替えられる)
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === "videoinput"));
      } catch {
        // 一覧取得も失敗した場合は何もしない(権限自体が無いケース)
      }
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
        onFrameRef.current(frame, video);

        // fps 計測
        const c = fpsCounterRef.current;
        c.frames++;
        const now = performance.now();
        if (now - c.since >= 1000) {
          setFps(c.frames);
          c.frames = 0;
          c.since = now;
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state]);

  return {
    videoRef,
    /** HandTracker(リングバッファ history へのアクセス用)*/
    trackerRef,
    state,
    errorMessage,
    devices,
    selectedDeviceId,
    startCamera,
    fps,
    delegate,
  };
}
