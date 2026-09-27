// BLE-MIDI パケット解析(仕様書 F-10)のユニットテスト
import { describe, expect, it } from "vitest";
import {
  BleMidiPacketParser,
  MidiStreamParser,
  toBytes,
  unwrapBleMidiPacket,
} from "../../src/midi/bleMidiPacket";

/** テスト用のパケットを作るヘルパー */
function packet(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

/** 1 つのパーサーで、パケットを順に読んだ結果をまとめて返す */
function parseAll(...packets: Uint8Array[]) {
  const parser = new BleMidiPacketParser();
  return packets.flatMap((p) => parser.parse(p));
}

// 0x80 = ヘッダ(タイムスタンプ上位 0)、0x81 などはタイムスタンプ
const H = 0x80;

describe("BLE-MIDI: 基本", () => {
  it("単音の Note On を読む", () => {
    expect(parseAll(packet(H, 0x81, 0x90, 60, 100))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
    ]);
  });

  it("1 パケットに Note On と Note Off が入っていても両方読む", () => {
    expect(parseAll(packet(H, 0x81, 0x90, 60, 100, 0x82, 0x80, 62, 0))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
      { type: "noteOff", note: 62, velocity: 0 },
    ]);
  });

  it("velocity 0 の Note On は Note Off として扱う", () => {
    expect(parseAll(packet(H, 0x81, 0x90, 60, 0))).toEqual([
      { type: "noteOff", note: 60, velocity: 0 },
    ]);
  });

  it("チャンネルが違っても読む", () => {
    expect(parseAll(packet(H, 0x81, 0x93, 64, 80))).toEqual([
      { type: "noteOn", note: 64, velocity: 80 },
    ]);
  });
});

describe("BLE-MIDI: ランニングステータス(ステータスの省略)", () => {
  it("タイムスタンプ付きで省略されたメッセージを読む", () => {
    expect(parseAll(packet(H, 0x81, 0x90, 60, 100, 0x82, 62, 90))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
      { type: "noteOn", note: 62, velocity: 90 },
    ]);
  });

  it("タイムスタンプなしで省略されたメッセージを読む", () => {
    expect(parseAll(packet(H, 0x81, 0x90, 60, 100, 62, 90, 64, 0))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
      { type: "noteOn", note: 62, velocity: 90 },
      { type: "noteOff", note: 64, velocity: 0 },
    ]);
  });

  it("パケットをまたいでも省略されたメッセージを読む", () => {
    expect(parseAll(packet(H, 0x81, 0x90, 60, 100), packet(H, 0x85, 60, 0))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
      { type: "noteOff", note: 60, velocity: 0 },
    ]);
  });

  it("システムコモン(0xF1〜0xF6)でランニングステータスが解除される", () => {
    // 0xF6(チューンリクエスト)の後の 62, 90 はステータスが無いので読まない
    expect(parseAll(packet(H, 0x81, 0x90, 60, 100, 0x82, 0xf6, 62, 90))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
    ]);
  });
});

describe("BLE-MIDI: タイムスタンプの取り違え", () => {
  it("タイムスタンプの値が 0x90 でもステータスと取り違えない", () => {
    // 0x90 はタイムスタンプ、その次の 0x80 が本物のステータス(Note Off)
    expect(parseAll(packet(H, 0x90, 0x80, 60, 64))).toEqual([
      { type: "noteOff", note: 60, velocity: 64 },
    ]);
  });

  it("ヘッダの下位ビットに値があっても読む", () => {
    expect(parseAll(packet(0xbf, 0xff, 0x90, 60, 100))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
    ]);
  });
});

describe("BLE-MIDI: リアルタイムメッセージ", () => {
  it("メッセージの前に挟まったリアルタイム(0xF8)を読み飛ばす", () => {
    expect(parseAll(packet(H, 0x81, 0xf8, 0x82, 0x90, 60, 100))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
    ]);
  });

  it("データバイトの間に挟まったリアルタイムを読み飛ばす", () => {
    expect(parseAll(packet(H, 0x81, 0x90, 60, 0x82, 0xf8, 100))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
    ]);
  });

  it("リアルタイムの後もランニングステータスが続く", () => {
    expect(parseAll(packet(H, 0x81, 0x90, 60, 100, 0x82, 0xfe, 62, 90))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
      { type: "noteOn", note: 62, velocity: 90 },
    ]);
  });
});

describe("BLE-MIDI: SysEx(読み飛ばす)", () => {
  it("1 パケット内の SysEx を読み飛ばし、後ろの Note On を読む", () => {
    expect(
      parseAll(packet(H, 0x81, 0xf0, 0x7e, 0x01, 0x82, 0xf7, 0x83, 0x90, 60, 100)),
    ).toEqual([{ type: "noteOn", note: 60, velocity: 100 }]);
  });

  it("複数パケットにまたがる SysEx を読み飛ばす", () => {
    expect(
      parseAll(
        packet(H, 0x81, 0xf0, 0x7e, 0x01),
        packet(H, 0x02, 0x03, 0x04), // 続きのパケット(ヘッダの次が bit7 = 0)
        packet(H, 0x82, 0xf7, 0x83, 0x90, 60, 100),
      ),
    ).toEqual([{ type: "noteOn", note: 60, velocity: 100 }]);
  });

  it("終わりの前のタイムスタンプが 0xF7 でも取り違えない", () => {
    // 0xF7 はタイムスタンプ、その次の 0xF7 が本物の終わり
    expect(
      parseAll(packet(H, 0x81, 0xf0, 0x01, 0x02, 0xf7, 0xf7, 0x81, 0x90, 60, 100)),
    ).toEqual([{ type: "noteOn", note: 60, velocity: 100 }]);
  });

  it("SysEx の中に挟まったリアルタイムを読み飛ばす", () => {
    expect(
      parseAll(packet(H, 0x81, 0xf0, 0x01, 0x82, 0xf8, 0x02, 0x83, 0xf7, 0x84, 0x90, 60, 100)),
    ).toEqual([{ type: "noteOn", note: 60, velocity: 100 }]);
  });

  it("SysEx の途中に通常のステータスが来たら打ち切って、そのメッセージを読む", () => {
    expect(parseAll(packet(H, 0x81, 0xf0, 0x01, 0x02, 0x82, 0x90, 60, 100))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
    ]);
  });
});

describe("BLE-MIDI: 無視するメッセージ", () => {
  it("コントロールチェンジ(0xB0)は返さず、後ろの Note On は読む", () => {
    expect(parseAll(packet(H, 0x81, 0xb0, 64, 127, 0x82, 0x90, 60, 100))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
    ]);
  });

  it("プログラムチェンジ(0xC0、データ 1 バイト)の後ろの Note On を正しく読む", () => {
    expect(parseAll(packet(H, 0x81, 0xc0, 5, 0x82, 0x90, 60, 100))).toEqual([
      { type: "noteOn", note: 60, velocity: 100 },
    ]);
  });

  it("データが足りないメッセージは返さない", () => {
    expect(parseAll(packet(H, 0x81, 0x90, 60))).toEqual([]);
  });
});

describe("BLE-MIDI: 壊れたパケット", () => {
  it("空・ヘッダだけ・末尾がタイムスタンプだけのパケットで落ちない", () => {
    expect(parseAll(packet())).toEqual([]);
    expect(parseAll(packet(H))).toEqual([]);
    expect(parseAll(packet(H, 0x81))).toEqual([]);
  });

  it("ヘッダが不正(bit7 = 0 / bit6 = 1)なパケットは捨てる", () => {
    expect(parseAll(packet(0x00, 0x81, 0x90, 60, 100))).toEqual([]);
    expect(parseAll(packet(0xc0, 0x81, 0x90, 60, 100))).toEqual([]);
  });
});

describe("unwrapBleMidiPacket / MidiStreamParser / toBytes", () => {
  it("包みをはがすとタイムスタンプだけが消える", () => {
    expect(unwrapBleMidiPacket(packet(H, 0x81, 0x90, 60, 100, 0x82, 0x80, 60, 0))).toEqual([
      0x90, 60, 100, 0x80, 60, 0,
    ]);
  });

  it("MidiStreamParser はバイト列を分けて渡しても組み立てられる", () => {
    const parser = new MidiStreamParser();
    expect(parser.push([0x90, 60])).toEqual([]);
    expect(parser.push([100])).toEqual([{ type: "noteOn", note: 60, velocity: 100 }]);
  });

  it("toBytes は先頭位置(byteOffset)のある DataView を正しく変換する", () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
    expect(Array.from(toBytes(new DataView(buffer, 2, 3)))).toEqual([3, 4, 5]);
  });
});
