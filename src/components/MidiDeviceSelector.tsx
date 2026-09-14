// MIDI 入力デバイスの選択 UI(仕様書 F-01 / 3.1)
//
// - デバイスの一覧表示・選択(未接続時は「バーチャル鍵盤」を選択可能)
// - 権限リクエストの誘導、拒否時のエラーと再試行(仕様書 10 章)
// - Bluetooth ペアリングのガイド文(仕様書 3.1。ペアリング自体は OS 側で行う)
// - つながらないときの原因調べ用に、ブラウザが報告している機器の状態を表示する

import { portDisplayName } from "./midiPortList";
import { VIRTUAL_DEVICE_ID, type UseMidiDevices } from "./useMidiDevices";

interface Props {
  midi: UseMidiDevices;
}

export function MidiDeviceSelector({ midi }: Props) {
  const { status, errorMessage, devices, selectedId, isSelectedConnected, diagnostics } =
    midi;
  const usingRealDevice = selectedId !== VIRTUAL_DEVICE_ID;
  const hasUsableDevice = devices.some((d) => d.connected);

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
                {d.connected ? d.name : `${d.name}(切断中)`}
              </option>
            ))}
          </select>
        </label>

        {status === "idle" && (
          <button onClick={() => void midi.requestAccess()} style={buttonStyle}>
            MIDI 機器に接続
          </button>
        )}

        {status === "granted" && (
          <button onClick={midi.rescan} style={buttonStyle}>
            再検索
          </button>
        )}

        {status === "granted" && !hasUsableDevice && (
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
          キーボードが一覧に出ない場合は、「再検索」を押してください。
          Bluetooth の場合は OS の Bluetooth 設定でペアリングを確認してください。
          Android で USB ケーブルを使う場合は、通知から USB の用途を「MIDI」にしてください。
          Windows では Bluetooth 接続が不安定なことがあるため、USB ケーブル接続を推奨します。
        </p>
      )}

      {/* 接続の詳細(うまくつながらないときの原因調べ用) */}
      {status === "granted" && (
        <details style={{ marginTop: 6, fontSize: 12, color: "#aaa" }}>
          <summary style={{ cursor: "pointer" }}>接続の詳細(うまくつながらないとき用)</summary>
          <div style={{ marginTop: 4, lineHeight: 1.6 }}>
            <div>
              入力ポート: {diagnostics.inputs.length} 個
              {diagnostics.inputs.map((p) => (
                <div key={p.id} style={{ paddingLeft: 12 }}>
                  ・{portDisplayName(p)} / state={p.state || "(空)"} / connection=
                  {p.connection || "(空)"}
                </div>
              ))}
            </div>
            <div>
              出力ポート: {diagnostics.outputs.length} 個
              {diagnostics.outputs.map((p) => (
                <div key={p.id} style={{ paddingLeft: 12 }}>
                  ・{portDisplayName(p)} / state={p.state || "(空)"} / connection=
                  {p.connection || "(空)"}
                </div>
              ))}
            </div>
            <div>抜き差しの通知: {diagnostics.stateChangeCount} 回</div>
            <div>
              最後に調べた時刻:{" "}
              {diagnostics.lastScanAt
                ? new Date(diagnostics.lastScanAt).toLocaleTimeString()
                : "まだ調べていません"}
            </div>
          </div>
        </details>
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
