// Bluetooth MIDI の接続(仕様書 F-10)のユニットテスト
//
// 本物の Bluetooth 機器は使えないので、同じ形の偽の機器(EventTarget)を作って確かめる。
import { describe, expect, it } from "vitest";
import {
  BLE_MIDI_CHARACTERISTIC_UUID,
  BLE_MIDI_SERVICE_UUID,
  BleMidiInput,
} from "../../src/midi/bleMidiInput";
import type { NoteMessage } from "../../src/midi/types";

/** 偽のキャラクタリスティック(データの受信口) */
class FakeCharacteristic extends EventTarget {
  value: DataView | undefined;
  notifying = false;
  stopCount = 0;

  async startNotifications() {
    this.notifying = true;
    return this as unknown as BluetoothRemoteGATTCharacteristic;
  }

  async stopNotifications() {
    this.notifying = false;
    this.stopCount++;
    return this as unknown as BluetoothRemoteGATTCharacteristic;
  }

  /** キーボードからデータが届いたことにする */
  emit(bytes: number[]) {
    this.value = new DataView(new Uint8Array(bytes).buffer);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

/** 偽の機器(キーボード) */
class FakeDevice extends EventTarget {
  id = "fake-device";
  name = "microKEY2 Air";
  characteristic = new FakeCharacteristic();
  connectCount = 0;
  disconnectCount = 0;
  /** サービスが見つからない機器(MIDI 非対応)を再現するときに true */
  missingService = false;

  gatt = {
    connected: false,
    connect: async () => {
      this.connectCount++;
      this.gatt.connected = true;
      return this.gatt;
    },
    disconnect: () => {
      this.disconnectCount++;
      this.gatt.connected = false;
    },
    getPrimaryService: async (uuid: string) => {
      expect(uuid).toBe(BLE_MIDI_SERVICE_UUID);
      if (this.missingService) {
        const e = new Error("No Services matching UUID found.");
        e.name = "NotFoundError";
        throw e;
      }
      return {
        getCharacteristic: async (charUuid: string) => {
          expect(charUuid).toBe(BLE_MIDI_CHARACTERISTIC_UUID);
          return this.characteristic as unknown as BluetoothRemoteGATTCharacteristic;
        },
      };
    },
  };

  /** キーボードの電源が切れたことにする */
  emitDisconnected() {
    this.gatt.connected = false;
    this.dispatchEvent(new Event("gattserverdisconnected"));
  }
}

/** 偽の navigator.bluetooth */
function fakeBluetooth(device: FakeDevice | Error): Bluetooth {
  return {
    requestDevice: async () => {
      if (device instanceof Error) throw device;
      return device as unknown as BluetoothDevice;
    },
  };
}

/** ヘッダ + タイムスタンプ + Note On(ド、velocity 100) */
const NOTE_ON_PACKET = [0x80, 0x81, 0x90, 60, 100];
/** ランニングステータスによる Note Off(velocity 0) */
const NOTE_OFF_PACKET = [0x80, 0x82, 60, 0];

describe("BleMidiInput: 接続と受信", () => {
  it("接続すると状態が connected になり、機器名を持つ", async () => {
    const device = new FakeDevice();
    const input = new BleMidiInput(fakeBluetooth(device));

    expect(input.isSupported()).toBe(true);
    expect(input.getState().status).toBe("idle");

    await input.connect();

    expect(input.getState()).toEqual({
      status: "connected",
      deviceName: "microKEY2 Air",
      errorMessage: "",
    });
    expect(device.characteristic.notifying).toBe(true);
  });

  it("受信したパケットを Note On / Note Off として配る", async () => {
    const device = new FakeDevice();
    const input = new BleMidiInput(fakeBluetooth(device));
    const ons: NoteMessage[] = [];
    const offs: NoteMessage[] = [];
    input.addNoteOnListener((m) => ons.push(m));
    input.addNoteOffListener((m) => offs.push(m));

    await input.connect();
    device.characteristic.emit(NOTE_ON_PACKET);
    device.characteristic.emit(NOTE_OFF_PACKET);

    expect(ons.map((m) => m.note)).toEqual([60]);
    expect(offs.map((m) => m.note)).toEqual([60]);
    // 時刻は判定(仕様書 7.2)に使うので、妥当な値が入っていること
    expect(ons[0].timestampMs).toBeGreaterThan(0);
  });

  it("状態の変化を購読できる", async () => {
    const device = new FakeDevice();
    const input = new BleMidiInput(fakeBluetooth(device));
    const statuses: string[] = [];
    input.subscribe((s) => statuses.push(s.status));

    await input.connect();

    expect(statuses).toEqual(["connecting", "connected"]);
  });
});

describe("BleMidiInput: 切断と再接続", () => {
  it("機器側が切れると disconnected になり、再接続でつなぎ直せる", async () => {
    const device = new FakeDevice();
    const input = new BleMidiInput(fakeBluetooth(device));
    await input.connect();

    device.emitDisconnected();
    expect(input.getState().status).toBe("disconnected");
    expect(input.getState().deviceName).toBe("microKEY2 Air");

    await input.reconnect();
    expect(input.getState().status).toBe("connected");
    expect(device.connectCount).toBe(2);
  });

  it("再接続してもリスナーが重複しない(1 回の受信で 1 回だけ届く)", async () => {
    const device = new FakeDevice();
    const input = new BleMidiInput(fakeBluetooth(device));
    const ons: NoteMessage[] = [];
    input.addNoteOnListener((m) => ons.push(m));

    await input.connect();
    device.emitDisconnected();
    await input.reconnect();
    device.characteristic.emit(NOTE_ON_PACKET);

    expect(ons).toHaveLength(1);
  });

  it("自分で切ると idle になり、その後の切断通知は無視する", async () => {
    const device = new FakeDevice();
    const input = new BleMidiInput(fakeBluetooth(device));
    await input.connect();

    input.disconnect();
    expect(input.getState().status).toBe("idle");
    expect(device.disconnectCount).toBe(1);

    // 切断通知が遅れて届いても「切断中」にはしない
    device.emitDisconnected();
    expect(input.getState().status).toBe("idle");
  });

  it("切った後は Note On を配らない", async () => {
    const device = new FakeDevice();
    const input = new BleMidiInput(fakeBluetooth(device));
    const ons: NoteMessage[] = [];
    input.addNoteOnListener((m) => ons.push(m));

    await input.connect();
    input.disconnect();
    device.characteristic.emit(NOTE_ON_PACKET);

    expect(ons).toHaveLength(0);
  });
});

describe("BleMidiInput: 失敗したとき", () => {
  it("機器選択を閉じた場合はエラーにしない", async () => {
    const cancelled = new Error("User cancelled the requestDevice() chooser.");
    cancelled.name = "NotFoundError";
    const input = new BleMidiInput(fakeBluetooth(cancelled));

    await input.connect();

    expect(input.getState().status).toBe("idle");
    expect(input.getState().errorMessage).toBe("");
  });

  it("MIDI に対応しない機器を選んだ場合はエラーを表示する", async () => {
    const device = new FakeDevice();
    device.missingService = true;
    const input = new BleMidiInput(fakeBluetooth(device));

    await input.connect();

    expect(input.getState().status).toBe("error");
    expect(input.getState().errorMessage).toContain("Bluetooth MIDI に対応していない");
  });

  it("Bluetooth 非対応の環境では、その旨を伝える", async () => {
    const input = new BleMidiInput(undefined);

    expect(input.isSupported()).toBe(false);
    await input.connect();

    expect(input.getState().status).toBe("error");
    expect(input.getState().errorMessage).toContain("対応していません");
  });
});
