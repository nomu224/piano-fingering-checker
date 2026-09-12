// 起動時のカメラ選択(仕様書 F-01)のユニットテスト
import { describe, expect, it } from "vitest";
import { isVirtualCamera, pickRealCamera } from "../../src/components/cameraSelection";

describe("isVirtualCamera", () => {
  it("仮想カメラの名前を見分ける", () => {
    expect(isVirtualCamera("e2eSoft iVCam")).toBe(true);
    expect(isVirtualCamera("OBS Virtual Camera")).toBe(true);
    expect(isVirtualCamera("DroidCam Source 3")).toBe(true);
  });

  it("実カメラは仮想カメラと判定しない", () => {
    expect(isVirtualCamera("Integrated Camera (174f:180f)")).toBe(false);
    expect(isVirtualCamera("HD Pro Webcam C920")).toBe(false);
    expect(isVirtualCamera("前面カメラ")).toBe(false);
  });
});

describe("pickRealCamera", () => {
  const ivcam = { deviceId: "v1", label: "e2eSoft iVCam" };
  const builtin = { deviceId: "r1", label: "Integrated Camera (174f:180f)" };

  it("仮想カメラが選ばれていて実カメラがあれば、実カメラに切り替える", () => {
    expect(pickRealCamera([ivcam, builtin], "v1")).toBe("r1");
  });

  it("すでに実カメラを使っているなら切り替えない", () => {
    expect(pickRealCamera([ivcam, builtin], "r1")).toBeNull();
  });

  it("実カメラが無ければ切り替えない(仮想カメラしか無い環境)", () => {
    expect(pickRealCamera([ivcam], "v1")).toBeNull();
  });

  it("名前が取れない(権限前など)場合は判断せず既定のまま", () => {
    expect(pickRealCamera([{ deviceId: "v1", label: "" }], "v1")).toBeNull();
  });

  it("名前が空のデバイスは切り替え先にしない", () => {
    expect(pickRealCamera([ivcam, { deviceId: "x", label: "" }], "v1")).toBeNull();
  });

  it("現在のカメラが不明なら何もしない", () => {
    expect(pickRealCamera([ivcam, builtin], undefined)).toBeNull();
    expect(pickRealCamera([ivcam, builtin], "unknown")).toBeNull();
  });
});
