// MIDI 機器の一覧の作り方(仕様書 F-01 / 3.1)
//
// Web MIDI API が報告するポート情報から、選択欄に出す一覧を作る純粋な関数。
// (ブラウザの型に依存しないので、ユニットテストできる)
//
// 【経緯】以前は state === "connected" のポートだけを一覧に出していたが、
// Android タブレットで「他のサイトではつながるのに、このアプリでは見つからない」問題が起きた。
// 端末によって状態の報告のしかたが違う可能性があるため、
// **「切断されている」とはっきり分かるもの以外は使える機器として扱う**。

/** ブラウザから取り出したポートの情報(MIDIPort の一部を写したもの) */
export interface PortSnapshot {
  id: string;
  name: string | null;
  manufacturer: string | null;
  /** "connected" / "disconnected" など */
  state: string;
  /** "open" / "closed" / "pending" など */
  connection: string;
}

/** 選択欄に出す機器 */
export interface MidiDeviceInfo {
  id: string;
  name: string;
  /** 使える状態か(false なら一覧に「切断中」と表示する) */
  connected: boolean;
}

/** 機器の表示名(名前 → メーカー名 → ID の順に、空でないものを使う) */
export function portDisplayName(port: PortSnapshot): string {
  return port.name || port.manufacturer || port.id;
}

/** 使える機器として扱うか(はっきり「切断」と報告されたものだけを除く) */
export function isPortUsable(state: string): boolean {
  return state !== "disconnected";
}

/**
 * 選択欄に出す一覧を作る。
 * - 同じ ID は 1 つにまとめる
 * - 使える機器を先に、切断中の機器を後ろに並べる(それぞれの中では元の順番のまま)
 */
export function buildDeviceList(ports: readonly PortSnapshot[]): MidiDeviceInfo[] {
  const seen = new Set<string>();
  const list: MidiDeviceInfo[] = [];
  for (const port of ports) {
    if (seen.has(port.id)) continue;
    seen.add(port.id);
    list.push({
      id: port.id,
      name: portDisplayName(port),
      connected: isPortUsable(port.state),
    });
  }
  return [...list.filter((d) => d.connected), ...list.filter((d) => !d.connected)];
}
