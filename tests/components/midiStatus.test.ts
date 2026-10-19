// 見出しに出す MIDI の状態(仕様書 9 章 / F-02)のユニットテスト
import { describe, expect, it } from "vitest";
import {
  isRealKeyboardConnected,
  midiStatusText,
  VIRTUAL_DEVICE_ID,
  type MidiStatusInput,
} from "../../src/components/useMidiDevices";

/** テスト用の状態を作る(既定はバーチャル鍵盤のみ) */
function input(over: Partial<MidiStatusInput> = {}): MidiStatusInput {
  return {
    selectedId: VIRTUAL_DEVICE_ID,
    isSelectedConnected: false,
    devices: [],
    bluetooth: { status: "idle", deviceName: "" },
    ...over,
  };
}

const realDevice = {
  selectedId: "dev-1",
  isSelectedConnected: true,
  devices: [{ id: "dev-1", name: "microKEY2 Air", connected: true }],
};

describe("isRealKeyboardConnected", () => {
  it("バーチャル鍵盤だけなら false(鍵盤を最初から開く)", () => {
    expect(isRealKeyboardConnected(input())).toBe(false);
  });

  it("USB / Web MIDI の機器につながっていれば true", () => {
    expect(isRealKeyboardConnected(input(realDevice))).toBe(true);
  });

  it("Bluetooth でつながっていれば true", () => {
    expect(
      isRealKeyboardConnected(
        input({ bluetooth: { status: "connected", deviceName: "microKEY2 Air" } }),
      ),
    ).toBe(true);
  });

  it("機器を選んでいても切断中なら false", () => {
    expect(isRealKeyboardConnected(input({ ...realDevice, isSelectedConnected: false }))).toBe(
      false,
    );
  });

  it("Bluetooth が切断中なら false", () => {
    expect(
      isRealKeyboardConnected(
        input({ bluetooth: { status: "disconnected", deviceName: "microKEY2 Air" } }),
      ),
    ).toBe(false);
  });
});

describe("midiStatusText", () => {
  it("未接続ならバーチャル鍵盤と出す", () => {
    expect(midiStatusText(input())).toBe("バーチャル鍵盤");
  });

  it("接続中の機器名を出す", () => {
    expect(midiStatusText(input(realDevice))).toBe("MIDI: microKEY2 Air");
  });

  it("Bluetooth 接続中は機器名を出す(Web MIDI より優先)", () => {
    expect(
      midiStatusText(
        input({ ...realDevice, bluetooth: { status: "connected", deviceName: "microKEY2 Air" } }),
      ),
    ).toBe("Bluetooth: microKEY2 Air");
  });

  it("一覧に無い ID を選んでいても落ちない", () => {
    expect(midiStatusText(input({ selectedId: "unknown", isSelectedConnected: true }))).toBe(
      "MIDI: 接続中",
    );
  });
});
