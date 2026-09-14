// MIDI 機器の一覧の作り方(仕様書 F-01)のユニットテスト
import { describe, expect, it } from "vitest";
import {
  buildDeviceList,
  isPortUsable,
  portDisplayName,
  type PortSnapshot,
} from "../../src/components/midiPortList";

function port(overrides: Partial<PortSnapshot>): PortSnapshot {
  return {
    id: "p1",
    name: "microKEY2 Air",
    manufacturer: "KORG",
    state: "connected",
    connection: "closed",
    ...overrides,
  };
}

describe("isPortUsable", () => {
  it("接続中の機器は使える", () => {
    expect(isPortUsable("connected")).toBe(true);
  });

  it("はっきり切断と報告された機器だけを使えない扱いにする", () => {
    expect(isPortUsable("disconnected")).toBe(false);
  });

  it("想定外の状態の報告でも、切断でなければ使える扱いにする(端末差への備え)", () => {
    expect(isPortUsable("")).toBe(true);
    expect(isPortUsable("unknown")).toBe(true);
  });
});

describe("portDisplayName", () => {
  it("名前があれば名前を使う", () => {
    expect(portDisplayName(port({}))).toBe("microKEY2 Air");
  });

  it("名前が無い・空ならメーカー名、それも無ければ ID を使う", () => {
    expect(portDisplayName(port({ name: null }))).toBe("KORG");
    expect(portDisplayName(port({ name: "" }))).toBe("KORG");
    expect(portDisplayName(port({ name: "", manufacturer: null }))).toBe("p1");
  });
});

describe("buildDeviceList", () => {
  it("接続中の機器が一覧に出る", () => {
    expect(buildDeviceList([port({})])).toEqual([
      { id: "p1", name: "microKEY2 Air", connected: true },
    ]);
  });

  it("状態の報告が想定外でも一覧から消さない", () => {
    const list = buildDeviceList([port({ state: "" })]);
    expect(list).toHaveLength(1);
    expect(list[0].connected).toBe(true);
  });

  it("切断中の機器は後ろに並べ、切断中として印を付ける", () => {
    const list = buildDeviceList([
      port({ id: "old", name: "古いキーボード", state: "disconnected" }),
      port({ id: "new", name: "microKEY2 Air", state: "connected" }),
    ]);
    expect(list.map((d) => d.id)).toEqual(["new", "old"]);
    expect(list[1].connected).toBe(false);
  });

  it("同じ ID の機器は 1 つにまとめる", () => {
    expect(buildDeviceList([port({}), port({})])).toHaveLength(1);
  });

  it("機器が無ければ空", () => {
    expect(buildDeviceList([])).toEqual([]);
  });
});
