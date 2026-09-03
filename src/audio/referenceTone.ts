// 参照音の生成(仕様書 F-08)
//
// MIDI キーボードは音源を持たない機種が多く、押しても音が鳴らないままでは練習にならないため、
// 押された音の高さの音をアプリ側で鳴らす。
//
// - オシレーター(倍音を数本重ねる)+ ADSR エンベロープでピアノらしい響きに寄せる
// - 音源ファイルは読み込まない(遅延を最小化するため)
// - AudioContext はアプリ共有のものを 1 個だけ使う(audioContext.ts)
//
// 外部ライブラリは使わず Web Audio 標準 API のみで実装する(仕様書 5 章)。

import {
  REFERENCE_ATTACK_MS,
  REFERENCE_DECAY_TIME_CONSTANT_MS,
  REFERENCE_HARMONICS,
  REFERENCE_RELEASE_MS,
  REFERENCE_TONE_MAX_SECONDS,
  REFERENCE_TONE_VOLUME,
} from "../core/constants";
import { getAudioContext } from "./audioContext";

/**
 * MIDI ノート番号 → 周波数(Hz)。
 * A4(ノート番号 69)= 440Hz を基準に、半音ごとに 2^(1/12) 倍になる。
 */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 鳴っている 1 音ぶんのノード群 */
interface Voice {
  oscillators: OscillatorNode[];
  gain: GainNode;
  /** 最大発音時間で自動停止する予約 */
  stopTimer: ReturnType<typeof setTimeout>;
}

export class ReferenceTone {
  /** 全 voice を通すマスターゲイン(和音やビープと重なってもクリップしないように) */
  private master: GainNode | null = null;

  /**
   * 押下中の voice。
   * 【重要】Map は「押下中のもの」だけを持つ。Note Off や連打の時点でまず Map から外し、
   * 外れた voice はリリースして自走で消える(連打の余韻が自然に重なる)。
   */
  private voices = new Map<number, Voice>();

  /** マスターゲイン + コンプレッサーを用意する(初回のみ) */
  private ensureMaster(): GainNode {
    if (this.master) return this.master;
    const ctx = getAudioContext();
    const master = ctx.createGain();
    master.gain.value = 1;
    // 和音 + ビープが重なったときの歪みを抑える(Web Audio 標準ノード)
    const compressor = ctx.createDynamicsCompressor();
    master.connect(compressor);
    compressor.connect(ctx.destination);
    this.master = master;
    return master;
  }

  /**
   * 参照音を鳴らす(F-08: Note On 受信時に即座に再生)。
   * 譜面と違う音でもそのまま鳴らす(実際のピアノと同じ挙動)。
   */
  noteOn(midi: number): void {
    const ctx = getAudioContext();
    const master = this.ensureMaster();
    const now = ctx.currentTime;

    // 同じ音が鳴っていたら、まず Map から外してリリースさせる(同音連打の対応)
    this.releaseVoice(midi);

    const gain = ctx.createGain();
    const attackSec = REFERENCE_ATTACK_MS / 1000;

    // ADSR: 速いアタック → 緩やかな指数減衰(F-08)
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(REFERENCE_TONE_VOLUME, now + attackSec);
    gain.gain.setTargetAtTime(
      0,
      now + attackSec,
      REFERENCE_DECAY_TIME_CONSTANT_MS / 1000,
    );
    gain.connect(master);

    // 倍音を数本重ねてピアノらしい響きに寄せる(F-08)
    const frequency = midiToFrequency(midi);
    const oscillators = REFERENCE_HARMONICS.map(([multiple, level]) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = frequency * multiple;
      const harmonicGain = ctx.createGain();
      harmonicGain.gain.value = level;
      osc.connect(harmonicGain);
      harmonicGain.connect(gain);
      osc.start(now);
      return osc;
    });

    // 【重要】setTargetAtTime は数学的にゼロへ到達しないため、stop を予約しないと
    // オシレータが永遠に走り続けてノードが溜まる。最大発音時間で必ず止める。
    // Note Off が来ない経路(タブ切替・オクターブシフト・USB 抜線)への最後の砦でもある。
    const voice: Voice = {
      oscillators,
      gain,
      stopTimer: setTimeout(() => {
        this.releaseVoice(midi, voice);
      }, REFERENCE_TONE_MAX_SECONDS * 1000),
    };
    this.voices.set(midi, voice);
  }

  /** 鍵盤を離したときに呼ぶ(実際のピアノのダンパーに相当) */
  noteOff(midi: number): void {
    this.releaseVoice(midi);
  }

  /** 鳴っている音をすべて止める(画面離脱・フォーカス喪失時) */
  stopAll(): void {
    for (const midi of [...this.voices.keys()]) {
      this.releaseVoice(midi);
    }
  }

  /**
   * 指定した音をリリースして破棄する。
   * @param expected 指定した場合、Map の中身がこの voice と同じときだけ外す(同一性チェック)
   */
  private releaseVoice(midi: number, expected?: Voice): void {
    const voice = this.voices.get(midi);
    if (!voice) return;
    // 【重要】同一性チェック。古い voice のタイマーが新しい voice を消さないようにする
    // (これが無いと、連打後にその音の Note Off が効かず鳴りっぱなしになる)
    if (expected && voice !== expected) return;

    this.voices.delete(midi);
    clearTimeout(voice.stopTimer);

    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const releaseSec = REFERENCE_RELEASE_MS / 1000;
    const stopTime = now + releaseSec;

    // 現在値からランプで 0 に落とす(即 0 にするとプチッと鳴るため)
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, stopTime);

    for (const osc of voice.oscillators) {
      osc.stop(stopTime);
      osc.onended = () => osc.disconnect();
    }
    // ゲインノードも遅れて破棄する
    setTimeout(() => voice.gain.disconnect(), REFERENCE_RELEASE_MS + 50);
  }
}

/** アプリ共有の参照音インスタンス(AudioContext と同じく 1 個だけ) */
let instance: ReferenceTone | null = null;

export function getReferenceTone(): ReferenceTone {
  instance ??= new ReferenceTone();
  return instance;
}
