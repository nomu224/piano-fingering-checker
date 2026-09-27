// Web Bluetooth API の型定義(仕様書 F-10)
//
// TypeScript 5.8 の標準の型定義には Web Bluetooth が含まれていない。
// 外部の型パッケージ(@types/web-bluetooth)は入れない方針なので、
// このアプリで使う部分だけを自分で宣言する(仕様書 5 章: 外部ライブラリは最小限)。
//
// import / export を書かないことで「グローバルな宣言」になる。

interface BluetoothServiceFilter {
  services: string[];
}

interface BluetoothRequestDeviceOptions {
  filters: BluetoothServiceFilter[];
}

interface Bluetooth {
  /** Bluetooth が使える環境かどうか(対応していても電源が切れている場合は false) */
  getAvailability?(): Promise<boolean>;
  /** 機器選択の画面を出す。ユーザー操作(クリック)から直接呼ぶ必要がある */
  requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
}

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  /** 受信したデータ。characteristicvaluechanged のときに読む */
  readonly value?: DataView;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface Navigator {
  /** 非対応ブラウザでは存在しない */
  readonly bluetooth?: Bluetooth;
}
