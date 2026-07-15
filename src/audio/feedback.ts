// フィードバック音の生成(仕様書 F-05 / 5 章: Web Audio API 直接使用、ビープ音生成のみ)
//
// - ビープ A(運指ミス): 低め・ブザー的 → 矩形波 220Hz・約 150ms
// - ビープ B(音ミス): 音色を変える → サイン波 880Hz・約 100ms
// - クリック音(正解時。F-05「無音(または設定でクリック音)」)→ サイン波 1500Hz・約 30ms
// - ON/OFF と音量は設定 F-07 から setEnabled / setVolume で反映する
// 周波数・波形・長さは仕様に具体値が無いため耳で調整した値(必要なら変更可)。
//
// AudioContext はブラウザの自動再生制限のため、ユーザー操作(打鍵・ボタン)を
// きっかけに遅延生成する。

import { FEEDBACK_VOLUME } from "../core/constants";

export class FeedbackSound {
  private ctx: AudioContext | null = null;

  /** フィードバック音の ON/OFF(F-07) */
  private enabled = true;

  /** 音量 0〜1(F-07) */
  private volume = FEEDBACK_VOLUME;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
  }

  /** 音を出す準備(初回のユーザー操作時に呼ばれる)。suspend 状態なら再開する */
  private ensureContext(): AudioContext {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /** ビープを 1 回鳴らす(内部共通)。OFF のときは鳴らさない */
  private beep(type: OscillatorType, frequency: number, durationMs: number): void {
    if (!this.enabled || this.volume <= 0) return;
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = frequency;

    // プチノイズ防止に短いフェードイン/アウトを付ける
    const now = ctx.currentTime;
    const duration = durationMs / 1000;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.volume, now + 0.005);
    gain.gain.setValueAtTime(this.volume, now + Math.max(0.005, duration - 0.02));
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  /** ビープ A: 運指ミス(低め・ブザー的。F-05) */
  fingerMiss(): void {
    this.beep("square", 220, 150);
  }

  /** ビープ B: 音ミス(運指ミスと音色を変える。F-05) */
  noteMiss(): void {
    this.beep("sine", 880, 100);
  }

  /** クリック音: 正解時(設定 clickOnCorrect が ON のときだけ UI から呼ぶ。F-05) */
  click(): void {
    this.beep("sine", 1500, 30);
  }

  /** リソース解放(画面離脱時) */
  close(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
