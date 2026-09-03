// 実 MIDI デバイスからの入力(仕様書 F-01 の MIDI 部分 / 3.1)
//
// Web MIDI API を「標準 API のまま直接」使用する(仕様書 5 章: ラッパーライブラリ不要)。
// 外部ライブラリは一切使わない。
//
// バーチャル鍵盤(virtualKeyboard.ts)と同じ MidiSource インターフェースを実装するため、
// 判定エンジン側は入力源を区別しない(仕様書 F-02)。

import { MIDI_TIMESTAMP_SANITY_MS } from "../core/constants";
import type { MidiSource, NoteHandler, NoteMessage } from "./types";

/** MIDI メッセージの解析結果 */
export interface ParsedMidiMessage {
  type: "noteOn" | "noteOff";
  note: number;
  velocity: number;
}

/**
 * MIDI メッセージを解析する(純関数・テスト対象)。
 * 先頭 3 バイトだけを見る。Note On / Note Off 以外はすべて null(無視)。
 *
 * - 上位 4bit でメッセージ種別を判定し、下位 4bit のチャンネルは問わない(全チャンネル受け付け)
 * - 0x9n = Note On。ただし velocity 0 は Note Off として扱う(MIDI の慣習。
 *   多くの鍵盤が離鍵をこの形で送るため)
 * - 0x8n = Note Off
 * - コントロールチェンジ・ピッチベンド・アクティブセンシング(0xFE)・
 *   MIDI Clock(0xF8)などは null(特にリアルタイムメッセージは大量に届くので無視の徹底が必要)
 *
 * @param data MIDIMessageEvent.data(DOM 型定義上 null になり得る)
 */
export function parseMidiMessage(
  data: Uint8Array | null | undefined,
): ParsedMidiMessage | null {
  if (!data || data.length < 3) return null;

  const status = data[0] & 0xf0; // 上位 4bit = 種別(下位 4bit のチャンネルは無視)
  const note = data[1];
  const velocity = data[2];

  if (status === 0x90) {
    // velocity 0 の Note On は Note Off として扱う
    return velocity === 0
      ? { type: "noteOff", note, velocity }
      : { type: "noteOn", note, velocity };
  }
  if (status === 0x80) {
    return { type: "noteOff", note, velocity };
  }
  return null; // Note On/Off 以外は無視
}

/**
 * 実 MIDI デバイスからの入力源。
 * インスタンスは 1 個だけ作り、connect() / disconnect() で内側のデバイスを差し替える
 * (参照が変わるとリスナー登録が壊れるため)。
 */
export class MidiDeviceInput implements MidiSource {
  private port: MIDIInput | null = null;

  private noteOnHandlers = new Set<NoteHandler>();
  private noteOffHandlers = new Set<NoteHandler>();

  /** 直近の「デバイス時刻 − performance.now()」の差(ms)。遅延のデバッグ表示用 */
  private lastTimestampDelta = 0;

  // ---- MidiSource 実装(バーチャル鍵盤と同じインターフェース) ----

  addNoteOnListener(handler: NoteHandler): () => void {
    this.noteOnHandlers.add(handler);
    return () => this.noteOnHandlers.delete(handler);
  }

  addNoteOffListener(handler: NoteHandler): () => void {
    this.noteOffHandlers.add(handler);
    return () => this.noteOffHandlers.delete(handler);
  }

  // ---- デバイスの接続管理 ----

  /** 指定デバイスの受信を開始する(既存の接続は解除してから差し替える) */
  connect(port: MIDIInput): void {
    this.disconnect();
    this.port = port;
    port.onmidimessage = (event) => this.handleMessage(event);
  }

  /** 受信を停止する */
  disconnect(): void {
    if (this.port) {
      this.port.onmidimessage = null;
      this.port = null;
    }
  }

  /** 現在接続中のデバイス ID(未接続なら null) */
  getConnectedId(): string | null {
    return this.port?.id ?? null;
  }

  /** 直近の「デバイス時刻 − performance.now()」の差(ms)。USB と Bluetooth の遅延差の確認用 */
  getLastTimestampDelta(): number {
    return this.lastTimestampDelta;
  }

  private handleMessage(event: MIDIMessageEvent): void {
    const parsed = parseMidiMessage(event.data);
    if (!parsed) return;

    const timestampMs = this.sanitizeTimestamp(event.timeStamp);
    const msg: NoteMessage = { note: parsed.note, timestampMs };

    if (parsed.type === "noteOn") {
      this.noteOnHandlers.forEach((h) => h(msg));
    } else {
      this.noteOffHandlers.forEach((h) => h(msg));
    }
  }

  /**
   * タイムスタンプの正常性チェック(仕様書 7.2 の精度に直結)。
   *
   * MIDIMessageEvent.timeStamp は performance.now() と同一基準のはずだが、
   * 万一かけ離れた値(epoch 基準など)が来ると、ランドマーク履歴の最近傍検索が
   * 常に最古フレームを掴み、エラーも出さずに指特定が誤り続ける。
   * そのため妥当な範囲外なら現在時刻にフォールバックする。
   */
  private sanitizeTimestamp(raw: number): number {
    const now = performance.now();
    if (Number.isFinite(raw) && raw > 0 && Math.abs(raw - now) < MIDI_TIMESTAMP_SANITY_MS) {
      this.lastTimestampDelta = raw - now;
      return raw;
    }
    this.lastTimestampDelta = 0;
    return now;
  }
}
