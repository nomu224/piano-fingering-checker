// Bluetooth 接続エラーの日本語化(仕様書 F-10 / 10 章)のユニットテスト
import { describe, expect, it } from "vitest";
import { toBleErrorMessage } from "../../src/midi/bleMidiErrors";

/** DOMException のふりをするエラー(node 環境でも作れるように Error の name を差し替える) */
function err(name: string, message = ""): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe("toBleErrorMessage", () => {
  it("機器選択を閉じただけなら、エラーを表示しない", () => {
    expect(toBleErrorMessage(err("NotFoundError", "User cancelled the requestDevice() chooser."), "choose")).toBeNull();
  });

  it("Bluetooth が使えない端末なら、その旨を伝える", () => {
    expect(
      toBleErrorMessage(err("NotFoundError", "Bluetooth adapter not available."), "choose"),
    ).toContain("Bluetooth が使えません");
  });

  it("接続後の NotFoundError は「MIDI 非対応の機器」として伝える", () => {
    expect(toBleErrorMessage(err("NotFoundError", "No Services found"), "connect")).toContain(
      "Bluetooth MIDI に対応していない",
    );
  });

  it("権限エラーは許可の案内を出す", () => {
    expect(toBleErrorMessage(err("SecurityError"), "choose")).toContain("許可");
    expect(toBleErrorMessage(err("NotAllowedError"), "choose")).toContain("許可");
  });

  it("接続の失敗は電源・距離の確認を促す", () => {
    expect(toBleErrorMessage(err("NetworkError"), "connect")).toContain("電源");
  });

  it("知らないエラーは内容をそのまま添える", () => {
    expect(toBleErrorMessage(err("TypeError", "うまくいきません"), "connect")).toContain(
      "うまくいきません",
    );
  });
});
