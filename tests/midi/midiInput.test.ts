// MIDI メッセージ解析(仕様書 F-01 / 3.1)のユニットテスト
// DOM 型に触れずに済むよう、純関数 parseMidiMessage のみを対象にする。
import { describe, expect, it } from "vitest";
import { parseMidiMessage } from "../../src/midi/midiInput";

/** テスト用のメッセージを作るヘルパー */
function msg(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

describe("parseMidiMessage: Note On / Note Off", () => {
  it("Note On(0x90)を解釈する", () => {
    expect(parseMidiMessage(msg(0x90, 60, 100))).toEqual({
      type: "noteOn",
      note: 60,
      velocity: 100,
    });
  });

  it("velocity 0 の Note On は Note Off として扱う(MIDI の慣習)", () => {
    expect(parseMidiMessage(msg(0x90, 60, 0))).toEqual({
      type: "noteOff",
      note: 60,
      velocity: 0,
    });
  });

  it("velocity 1(最小値)は Note On のまま(velocity 0 との境界)", () => {
    expect(parseMidiMessage(msg(0x90, 60, 1))).toMatchObject({
      type: "noteOn",
      velocity: 1,
    });
  });

  it("Note Off(0x80)を解釈する", () => {
    expect(parseMidiMessage(msg(0x80, 62, 64))).toEqual({
      type: "noteOff",
      note: 62,
      velocity: 64,
    });
  });

  it("チャンネルが違っても同じように解釈する(全チャンネル受け付け)", () => {
    // 0x95 = チャンネル 6 の Note On、0x83 = チャンネル 4 の Note Off
    expect(parseMidiMessage(msg(0x95, 64, 80))).toMatchObject({
      type: "noteOn",
      note: 64,
    });
    expect(parseMidiMessage(msg(0x83, 64, 0))).toMatchObject({
      type: "noteOff",
      note: 64,
    });
  });
});

describe("parseMidiMessage: 無視するメッセージ", () => {
  it("コントロールチェンジ(0xB0)は無視する", () => {
    expect(parseMidiMessage(msg(0xb0, 64, 127))).toBeNull();
  });

  it("ピッチベンド(0xE0)は無視する", () => {
    expect(parseMidiMessage(msg(0xe0, 0, 64))).toBeNull();
  });

  it("アクティブセンシング(0xFE)は無視する(数百ms間隔で届き続けるため)", () => {
    expect(parseMidiMessage(msg(0xfe, 0, 0))).toBeNull();
  });

  it("MIDI Clock(0xF8)/ Start(0xFA)は無視する", () => {
    expect(parseMidiMessage(msg(0xf8, 0, 0))).toBeNull();
    expect(parseMidiMessage(msg(0xfa, 0, 0))).toBeNull();
  });

  it("データ長が足りないメッセージは無視する", () => {
    expect(parseMidiMessage(msg(0x90, 60))).toBeNull();
    expect(parseMidiMessage(msg())).toBeNull();
  });

  it("data が null / undefined でも落ちない(DOM 型が null 許容のため)", () => {
    expect(parseMidiMessage(null)).toBeNull();
    expect(parseMidiMessage(undefined)).toBeNull();
  });
});
