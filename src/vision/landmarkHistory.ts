// ランドマーク履歴のリングバッファ(仕様書 7.2 の重要注記)
//
// カメラのフレーム取得と Note On の時刻ズレ対策として、直近数フレームの
// 検出結果を保持し、Note On のタイムスタンプに最も近いフレームを取り出せるようにする。
// ブラウザ API に依存しない純 TypeScript(ユニットテスト対象)。

import { LANDMARK_HISTORY_SIZE } from "../core/constants";
import type { LandmarkFrame } from "../core/types";

export class LandmarkHistory {
  /** リングバッファ本体(固定長) */
  private readonly buffer: (LandmarkFrame | null)[];

  /** 次に書き込む位置 */
  private writeIndex = 0;

  /** これまでに書き込んだ総数(バッファが埋まっているかの判定用) */
  private count = 0;

  constructor(size: number = LANDMARK_HISTORY_SIZE) {
    if (size < 1) {
      throw new Error("リングバッファのサイズは 1 以上にしてください");
    }
    this.buffer = new Array<LandmarkFrame | null>(size).fill(null);
  }

  /** フレームを追加する(バッファが満杯なら最も古いものを上書き) */
  push(frame: LandmarkFrame): void {
    this.buffer[this.writeIndex] = frame;
    this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
    this.count++;
  }

  /**
   * 指定タイムスタンプ(Note On の時刻。performance.now() 基準)に
   * 最も近いフレームを返す。フレームが 1 つも無ければ null。
   */
  getNearestFrame(timestampMs: number): LandmarkFrame | null {
    let nearest: LandmarkFrame | null = null;
    let minDiff = Infinity;
    for (const frame of this.buffer) {
      if (frame === null) continue;
      const diff = Math.abs(frame.timestampMs - timestampMs);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = frame;
      }
    }
    return nearest;
  }

  /** 最新フレームを返す(プレビュー描画用)。無ければ null */
  getLatestFrame(): LandmarkFrame | null {
    if (this.count === 0) return null;
    const lastIndex =
      (this.writeIndex - 1 + this.buffer.length) % this.buffer.length;
    return this.buffer[lastIndex];
  }

  /** 保持中のフレーム数 */
  size(): number {
    return Math.min(this.count, this.buffer.length);
  }

  /** 全消去(カメラ切替時など、座標系が変わったときに呼ぶ) */
  clear(): void {
    this.buffer.fill(null);
    this.writeIndex = 0;
    this.count = 0;
  }
}
