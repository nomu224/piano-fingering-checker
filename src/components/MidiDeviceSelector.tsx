// MIDI 入力デバイスの選択 UI(仕様書 F-01 / 3.1)
//
// - デバイスの一覧表示・選択(未接続時は「バーチャル鍵盤」を選択可能)
// - 権限リクエストの誘導、拒否時のエラーと再試行(仕様書 10 章)
// - Bluetooth ペアリングのガイド文(仕様書 3.1。ペアリング自体は OS 側で行う)

import { VIRTUAL_DEVICE_ID, type UseMidiDevices } from "./useMidiDevices";

interface Props {
  midi: UseMidiDevices;
}

export function MidiDeviceSelector({ midi }: Props) {
  const { status, errorMessage, devices, selectedId, isSelectedConnected } = midi;
  const usingRealDevice = selectedId !== VIRTUAL_DEVICE_ID;

  return (
    <div
      style={{
        background: "#26263a",
        borderRadius: 8,
        padding: 10,
        marginBottom: 10,
        fontSize: 14,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          MIDI 機器:{" "}
          <select
            value={selectedId}
            onChange={(e) => midi.selectDevice(e.target.value)}
            style={{ fontSize: 14, padding: 4 }}
          >
            <option value={VIRTUAL_DEVICE_ID}>バーチャル鍵盤(画面)</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        {status === "idle" && (
          <button onClick={() => void midi.requestAccess()} style={buttonStyle}>
            MIDI 機器に接続
          </button>
        )}

        {status === "granted" && devices.length === 0 && (
          <span style={{ color: "#ffb300" }}>MIDI 機器が見つかりません</span>
        )}

        {status === "granted" && usingRealDevice && (
          <span style={{ color: isSelectedConnected ? "#8bc34a" : "#ffb300" }}>
            {isSelectedConnected ? "接続中" : "切断中(挿し直すと自動で再接続します)"}
          </span>
        )}
      </div>

      {/* エラー(権限拒否・非対応など)と再試行(仕様書 10 章) */}
      {(status === "denied" || status === "error" || status === "unsupported") && (
        <div style={{ marginTop: 8 }}>
          <p style={{ margin: "0 0 6px", color: "#ff8a80" }}>{errorMessage}</p>
          {status !== "unsupported" && (
            <button onClick={() => void midi.requestAccess()} style={buttonStyle}>
              再試行
            </button>
          )}
        </div>
      )}

      {/* 接続ガイド(仕様書 3.1) */}
      {status === "granted" && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#999" }}>
          キーボードが一覧に出ない場合は、OS の Bluetooth 設定でペアリングを確認してください。
          Windows では Bluetooth 接続が不安定なことがあるため、USB ケーブル接続を推奨します。
        </p>
      )}
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "6px 16px",
  fontSize: 14,
  background: "#3b3b52",
  color: "#eee",
  border: "1px solid #666",
  borderRadius: 6,
  cursor: "pointer",
};
