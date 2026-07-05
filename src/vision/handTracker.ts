// MediaPipe Hands(HandLandmarker)のラッパー(仕様書 5 章・7.2)
//
// - numHands: 2(両手)、GPU delegate 優先・失敗時は CPU にフォールバック
// - 検出結果を純データ型 LandmarkFrame に変換し、リングバッファ(landmarkHistory)に記録する
// - タイムスタンプは performance.now() 基準に統一(MIDI 側 NoteMessage と同一時計。
//   P3 で Note On の時刻に最も近いフレームを選ぶための必須条件)

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { SWAP_HANDEDNESS } from "../core/constants";
import type { DetectedHand, Hand, LandmarkFrame } from "../core/types";
import { LandmarkHistory } from "./landmarkHistory";

/** WASM ランタイムとモデルの配置場所(public/ に同梱。CDN には依存しない) */
const WASM_BASE_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/hand_landmarker.task`;

/**
 * MediaPipe の handedness ラベルを生映像基準の左右に正規化する。
 * MediaPipe はセルフィービュー(反転映像)前提でラベルを付けるため、
 * 非反転映像では読み替えが必要な可能性がある(仕様書 7.2 の注意書き)。
 * 読み替えの有無は SWAP_HANDEDNESS 定数 1 箇所で切り替える。
 */
function normalizeHandedness(label: string): Hand {
  const isLeft = label === "Left";
  if (SWAP_HANDEDNESS) {
    return isLeft ? "R" : "L";
  }
  return isLeft ? "L" : "R";
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null;

  /** 実際に使われた delegate("GPU" / "CPU")。デバッグ表示用 */
  private delegateUsed: "GPU" | "CPU" | null = null;

  /** ランドマーク履歴(仕様書 7.2 の重要注記) */
  readonly history = new LandmarkHistory();

  /** detectForVideo に渡したタイムスタンプ(単調増加の保証用) */
  private lastDetectTimestamp = -1;

  /**
   * HandLandmarker を初期化する。GPU delegate を試し、失敗したら CPU で再試行する。
   * 初回はモデル(約 7.5MB)の読み込みがあるため数秒かかることがある。
   */
  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
    const baseOptions = { modelAssetPath: MODEL_PATH };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { ...baseOptions, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
      this.delegateUsed = "GPU";
    } catch {
      // GPU が使えない環境(古い端末・ドライバ)では CPU にフォールバック
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { ...baseOptions, delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
      this.delegateUsed = "CPU";
    }
  }

  isReady(): boolean {
    return this.landmarker !== null;
  }

  getDelegateUsed(): "GPU" | "CPU" | null {
    return this.delegateUsed;
  }

  /**
   * 1 フレーム分の手検出を行い、結果を履歴に記録して返す。
   * @param video 再生中の <video> 要素
   * @param timestampMs performance.now() 基準の現在時刻
   */
  detect(video: HTMLVideoElement, timestampMs: number): LandmarkFrame {
    if (!this.landmarker) {
      throw new Error("HandTracker が初期化されていません(init() を先に呼ぶこと)");
    }

    // detectForVideo のタイムスタンプは単調増加が必須。
    // まれに同値・逆行があると例外になるため保険をかける
    const ts = Math.max(timestampMs, this.lastDetectTimestamp + 1);
    this.lastDetectTimestamp = ts;

    const result = this.landmarker.detectForVideo(video, ts);

    const hands: DetectedHand[] = result.landmarks.map((landmarks, i) => {
      const handedness = result.handedness[i]?.[0];
      return {
        handedness: normalizeHandedness(handedness?.categoryName ?? "Right"),
        score: handedness?.score ?? 0,
        landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      };
    });

    const frame: LandmarkFrame = { timestampMs, hands };
    this.history.push(frame);
    return frame;
  }

  /** リソースを解放する(画面離脱時に呼ぶ) */
  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.delegateUsed = null;
    this.history.clear();
  }
}
