// Bluetooth MIDI キーボードへの直接接続(仕様書 F-10)
//
// Android では、OS の Bluetooth 設定でペアリングしても Web MIDI API にキーボードが現れない
// (どこかのアプリが MIDI 機器として開いている間だけ他のアプリに公開される仕組みのため)。
// そこでこのクラスが Web Bluetooth API でキーボードに直接つなぎ、
// BLE-MIDI のデータを自分で読み取る。外部ライブラリは使わない(仕様書 5 章)。
//
// バーチャル鍵盤・実 MIDI 入力と同じ MidiSource インターフェースを実装するので、
// 判定エンジン側は入力源を区別しない(仕様書 F-02)。

import { BleMidiPacketParser, toBytes } from "./bleMidiPacket";
import { toBleErrorMessage } from "./bleMidiErrors";
import { sanitizeTimestamp } from "./timestamp";
import type { MidiSource, NoteHandler, NoteMessage } from "./types";

/** BLE-MIDI の MIDI サービス。※ Web Bluetooth は小文字の UUID しか受け付けない */
export const BLE_MIDI_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
/** MIDI データのやり取りに使うキャラクタリスティック(通知で受信する) */
export const BLE_MIDI_CHARACTERISTIC_UUID = "7772e5db-3868-4112-a1a9-f2669d106bf3";

/**
 * 接続手順の打ち切り時間(ミリ秒)。
 * Android では gatt.connect() が長時間返ってこないことがあり、
 * その間「接続中…」のまま何もできなくなるのを防ぐ。
 */
const CONNECT_TIMEOUT_MS = 20_000;

/** Bluetooth 接続の状態 */
export type BleMidiStatus =
  | "idle" // まだつないでいない / 自分で切った
  | "connecting" // 接続手順の途中
  | "connected" // 受信できる
  | "disconnected" // つながっていたが切れた(再接続できる)
  | "error"; // 失敗(メッセージを表示する)

export interface BleMidiState {
  status: BleMidiStatus;
  /** 選んだ機器の名前(表示用) */
  deviceName: string;
  /** 失敗したときのメッセージ(status が error のときだけ使う) */
  errorMessage: string;
}

const INITIAL_STATE: BleMidiState = { status: "idle", deviceName: "", errorMessage: "" };

export class BleMidiInput implements MidiSource {
  /** テストから差し替えられるように、navigator.bluetooth を受け取れるようにしておく */
  private bluetooth: Bluetooth | undefined;

  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  /** BLE-MIDI パケットの解析器。接続ごとに作り直す(ランニングステータスの状態を持つため) */
  private parser = new BleMidiPacketParser();

  /**
   * 接続手順の世代番号。
   * 接続中に切断・再接続が起きたとき、古い手順の結果を捨てるために使う。
   */
  private generation = 0;

  private state: BleMidiState = INITIAL_STATE;
  private stateListeners = new Set<(state: BleMidiState) => void>();

  private noteOnHandlers = new Set<NoteHandler>();
  private noteOffHandlers = new Set<NoteHandler>();

  constructor(bluetooth: Bluetooth | undefined = getDefaultBluetooth()) {
    this.bluetooth = bluetooth;
  }

  // ---- MidiSource 実装(バーチャル鍵盤・実 MIDI と同じインターフェース) ----

  addNoteOnListener(handler: NoteHandler): () => void {
    this.noteOnHandlers.add(handler);
    return () => this.noteOnHandlers.delete(handler);
  }

  addNoteOffListener(handler: NoteHandler): () => void {
    this.noteOffHandlers.add(handler);
    return () => this.noteOffHandlers.delete(handler);
  }

  // ---- 状態の購読(UI 用) ----

  isSupported(): boolean {
    return typeof this.bluetooth?.requestDevice === "function";
  }

  getState(): BleMidiState {
    return this.state;
  }

  /** 状態の変化を購読する。戻り値は解除関数 */
  subscribe(listener: (state: BleMidiState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  // ---- 接続 ----

  /**
   * 機器選択の画面を出して接続する(「Bluetooth で接続」ボタンから呼ぶ)。
   *
   * 【重要】requestDevice はユーザー操作から直接呼ぶ必要があるため、
   * この関数の中で requestDevice より前に await を挟んではいけない。
   */
  async connect(): Promise<void> {
    const bluetooth = this.bluetooth;
    if (!bluetooth) {
      this.setState({
        ...this.state,
        status: "error",
        errorMessage:
          "このブラウザは Bluetooth 接続に対応していません。Chrome をお使いください。",
      });
      return;
    }

    let device: BluetoothDevice;
    try {
      device = await bluetooth.requestDevice({
        filters: [{ services: [BLE_MIDI_SERVICE_UUID] }],
      });
    } catch (e) {
      const message = toBleErrorMessage(e, "choose");
      // null = 利用者が選択画面を閉じただけ。状態はそのままにする
      if (message !== null) {
        this.setState({ ...this.state, status: "error", errorMessage: message });
      }
      return;
    }

    if (device !== this.device) {
      // 別の機器を選び直した場合は、前の機器の後始末をする
      this.releaseDevice();
      this.device = device;
      device.addEventListener("gattserverdisconnected", this.handleDisconnected);
    }
    await this.openConnection(device);
  }

  /** 選び直さずに、同じ機器へつなぎ直す(「再接続」ボタンから呼ぶ) */
  async reconnect(): Promise<void> {
    if (!this.device) {
      await this.connect();
      return;
    }
    await this.openConnection(this.device);
  }

  /** 自分から切る(画面を離れるときの後始末)。状態は idle に戻す */
  disconnect(): void {
    this.generation++; // 進行中の接続手順の結果を捨てる
    this.detachCharacteristic();
    this.setState({ ...INITIAL_STATE });
    try {
      this.device?.gatt?.disconnect();
    } catch {
      // すでに切れている場合は何もしなくてよい
    }
  }

  // ---- 内部処理 ----

  /** 接続手順(connect と reconnect で共通) */
  private async openConnection(device: BluetoothDevice): Promise<void> {
    const generation = ++this.generation;
    const deviceName = device.name || "Bluetooth MIDI 機器";
    this.setState({ status: "connecting", deviceName, errorMessage: "" });

    // 応答が返ってこないときのための打ち切り
    const timer = setTimeout(() => {
      if (this.generation !== generation) return;
      this.generation++; // これ以降、この手順の結果は使わない
      this.setState({
        status: "error",
        deviceName,
        errorMessage:
          "接続に時間がかかっています。キーボードの電源を入れ直して、もう一度「Bluetooth で接続」を押してください。",
      });
    }, CONNECT_TIMEOUT_MS);

    try {
      const server = device.gatt;
      if (!server) throw new Error("この機器には接続できません");

      await server.connect();
      if (this.generation !== generation) return;

      const service = await server.getPrimaryService(BLE_MIDI_SERVICE_UUID);
      if (this.generation !== generation) return;

      const characteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC_UUID);
      if (this.generation !== generation) return;

      // 前の接続の受信を外してから差し替える(二重に受信しないため)
      this.detachCharacteristic();
      this.characteristic = characteristic;
      this.parser = new BleMidiPacketParser();
      characteristic.addEventListener("characteristicvaluechanged", this.handleValueChanged);

      await characteristic.startNotifications();
      if (this.generation !== generation) return;

      this.setState({ status: "connected", deviceName, errorMessage: "" });
    } catch (e) {
      if (this.generation !== generation) return; // 途中で切断・再接続された結果は捨てる
      this.setState({
        status: "error",
        deviceName,
        errorMessage: toBleErrorMessage(e, "connect") ?? "Bluetooth での接続に失敗しました。",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 受信したパケットを Note On / Note Off にして配る。
   * ※ リスナーの二重登録を防ぐため、関数はフィールドに固定の参照で持つ
   */
  private handleValueChanged = (event: Event): void => {
    const target = event.target as BluetoothRemoteGATTCharacteristic | null;
    const value = target?.value;
    if (!value) return;

    const { timestampMs } = sanitizeTimestamp(event.timeStamp, performance.now());
    for (const parsed of this.parser.parse(toBytes(value))) {
      const msg: NoteMessage = { note: parsed.note, timestampMs };
      if (parsed.type === "noteOn") {
        this.noteOnHandlers.forEach((h) => h(msg));
      } else {
        this.noteOffHandlers.forEach((h) => h(msg));
      }
    }
  };

  /**
   * 機器側が切れたときの処理。
   * 自分で切った直後(idle)や接続手順の途中(connecting)の通知は無視する
   * (自分で切った場合も、切り替えの途中でもこのイベントは飛んでくるため)。
   */
  private handleDisconnected = (): void => {
    if (this.state.status === "idle" || this.state.status === "connecting") return;
    this.generation++; // 進行中の手順の結果を捨てる
    this.detachCharacteristic();
    this.setState({ ...this.state, status: "disconnected" });
  };

  /** 受信の購読を外す */
  private detachCharacteristic(): void {
    const characteristic = this.characteristic;
    if (!characteristic) return;
    this.characteristic = null;
    characteristic.removeEventListener("characteristicvaluechanged", this.handleValueChanged);
    // 切断後の stopNotifications は例外になるので、失敗は無視する
    void Promise.resolve(characteristic.stopNotifications?.()).catch(() => undefined);
  }

  /** 前に選んだ機器を手放す(別の機器を選び直したとき) */
  private releaseDevice(): void {
    const device = this.device;
    if (!device) return;
    this.detachCharacteristic();
    device.removeEventListener("gattserverdisconnected", this.handleDisconnected);
    try {
      device.gatt?.disconnect();
    } catch {
      // すでに切れている場合は何もしなくてよい
    }
    this.device = null;
  }

  private setState(next: BleMidiState): void {
    this.state = next;
    this.stateListeners.forEach((listener) => listener(next));
  }
}

/** 実行環境の navigator.bluetooth(非対応環境・テスト環境では undefined) */
function getDefaultBluetooth(): Bluetooth | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.bluetooth;
}
