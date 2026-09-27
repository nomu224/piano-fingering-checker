// BLE-MIDI パケットの解析(仕様書 F-10)
//
// Bluetooth の MIDI キーボードは、MIDI のデータを「BLE-MIDI パケット」という包みに入れて送ってくる。
// 包みには時刻(タイムスタンプ)のバイトが混ざっているため、そのままでは MIDI として読めない。
//
// Android 標準の BLE-MIDI 解読と同じく、2 段に分けて読む。
//   段 1: BLE の包みをはがす(タイムスタンプのバイトを取り除き、MIDI のバイト列にする)
//   段 2: MIDI のバイト列を 1 つずつのメッセージに組み立てる
// 最後に既存の parseMidiMessage を通して、Note On / Note Off だけを取り出す。
//
// UI・ブラウザ API に依存しない純 TypeScript(テスト対象)。

import { parseMidiMessage, type ParsedMidiMessage } from "./midiInput";

/**
 * 段 1: BLE の包みをはがす。
 *
 * パケットの形(BLE-MIDI 仕様):
 *   [ヘッダ] [タイムスタンプ] [MIDI バイト…] [タイムスタンプ] [MIDI バイト…] …
 * - ヘッダ: bit7 = 1、bit6 = 0
 * - ステータスバイト(bit7 = 1)の前には必ずタイムスタンプ(bit7 = 1)が入る
 * - ランニングステータス(ステータスの省略)ではタイムスタンプが付くことも付かないこともある
 *
 * よって「直前のバイトがタイムスタンプではない、かつ bit7 = 1」のバイトだけがタイムスタンプ。
 * この決め方なら、タイムスタンプの値がたまたま 0x90 や 0xF7 に見えても取り違えない。
 *
 * タイムスタンプの値そのものは使わない(受信時刻はブラウザのイベント時刻を使う)。
 *
 * @returns MIDI のバイト列。ヘッダが不正・空のパケットは空配列
 */
export function unwrapBleMidiPacket(packet: Uint8Array): number[] {
  if (packet.length === 0) return [];
  const header = packet[0];
  // ヘッダは bit7 = 1 かつ bit6 = 0 でなければ BLE-MIDI パケットではない
  if ((header & 0xc0) !== 0x80) return [];

  const midiBytes: number[] = [];
  // ヘッダの直後は「直前がタイムスタンプではない」扱い(次の bit7 = 1 はタイムスタンプ)
  let previousWasTimestamp = false;
  for (let i = 1; i < packet.length; i++) {
    const b = packet[i];
    if ((b & 0x80) !== 0 && !previousWasTimestamp) {
      previousWasTimestamp = true; // タイムスタンプなので捨てる
    } else {
      midiBytes.push(b);
      previousWasTimestamp = false;
    }
  }
  return midiBytes;
}

/** チャンネルメッセージ(0x80〜0xEF)のデータバイト数 */
function dataLengthOf(status: number): number {
  const type = status & 0xf0;
  // プログラムチェンジ(0xCn)とチャンネルプレッシャー(0xDn)だけ 1 バイト
  return type === 0xc0 || type === 0xd0 ? 1 : 2;
}

/**
 * 段 2: MIDI のバイト列をメッセージに組み立てる。
 * 状態(ランニングステータス・SysEx 中か)はパケットをまたいで保つので、接続ごとに 1 個作る。
 */
export class MidiStreamParser {
  /** 直近のチャンネルメッセージのステータス(省略されたときに使う)。無ければ null */
  private runningStatus: number | null = null;
  /** SysEx(0xF0〜0xF7)の途中か */
  private inSysEx = false;
  /** 組み立て中のデータバイト */
  private data: number[] = [];

  /** バイト列を読み、完成した Note On / Note Off を返す */
  push(bytes: readonly number[]): ParsedMidiMessage[] {
    const results: ParsedMidiMessage[] = [];
    for (const b of bytes) {
      const parsed = this.pushByte(b);
      if (parsed) results.push(parsed);
    }
    return results;
  }

  private pushByte(b: number): ParsedMidiMessage | null {
    // リアルタイムメッセージ(0xF8〜0xFF): どこに挟まっても 1 バイトで読み飛ばす。
    // ランニングステータスも組み立て中のデータも保つ(MIDI の規則)
    if (b >= 0xf8) return null;

    if (b === 0xf7) {
      // SysEx の終わり
      this.inSysEx = false;
      return null;
    }

    if ((b & 0x80) !== 0) {
      // ステータスバイトが来たら、SysEx の途中でもそこで打ち切る
      // (パケットが欠けて終わりの 0xF7 が届かなくても、次のメッセージから読めるようにするため)
      this.inSysEx = false;
      this.data = [];
      if (b === 0xf0) {
        // SysEx の始まり。中身は読み飛ばす
        this.inSysEx = true;
        this.runningStatus = null;
      } else if (b >= 0xf1) {
        // システムコモン(0xF1〜0xF6)。使わないので読み飛ばし、ランニングステータスを解除する
        this.runningStatus = null;
      } else {
        // チャンネルメッセージ(0x80〜0xEF)
        this.runningStatus = b;
      }
      return null;
    }

    // ここから下はデータバイト(bit7 = 0)
    if (this.inSysEx || this.runningStatus === null) return null; // 読み飛ばす

    this.data.push(b);
    if (this.data.length < dataLengthOf(this.runningStatus)) return null; // まだ揃っていない

    // 揃ったので 1 メッセージ完成。ランニングステータスは次のために残す
    const message = new Uint8Array([this.runningStatus, ...this.data]);
    this.data = [];
    // Note On / Note Off 以外(コントロールチェンジなど)は null になる
    return parseMidiMessage(message);
  }
}

/** BLE-MIDI パケットを Note On / Note Off にする(段 1 と段 2 をつなぐ。接続ごとに 1 個作る) */
export class BleMidiPacketParser {
  private stream = new MidiStreamParser();

  parse(packet: Uint8Array): ParsedMidiMessage[] {
    return this.stream.push(unwrapBleMidiPacket(packet));
  }
}

/**
 * DataView をバイト列にする。
 * DataView はより大きなバッファの一部を指していることがあるため、先頭位置(byteOffset)と長さを守る。
 */
export function toBytes(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}
