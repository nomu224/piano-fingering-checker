// MIDI 入力デバイスの選択 UI(仕様書 F-01 / F-10 / 3.1)
//
// - デバイスの一覧表示・選択(未接続時は「バーチャル鍵盤」を選択可能)
// - 権限リクエストの誘導、拒否時のエラーと再試行(仕様書 10 章)
// - Bluetooth キーボードは「Bluetooth で接続」からアプリが直接つなぐ(仕様書 F-10)。
//   Android では OS のペアリングだけではブラウザに機器が現れないため、
//   この部分は Web MIDI の許可状態とは関係なく、いつでも使えるように表示する
// - つながらないときの原因調べ用に、ブラウザが報告している機器の状態を表示する

import { portDisplayName } from "./midiPortList";
import { VIRTUAL_DEVICE_ID, type UseMidiDevices } from "./useMidiDevices";

interface Props {
  midi: UseMidiDevices;
}

export function MidiDeviceSelector({ midi }: Props) {
  const { status, errorMessage, devices, selectedId, isSelectedConnected, diagnostics, bluetooth } =
    midi;
  const usingRealDevice = selectedId !== VIRTUAL_DEVICE_ID;
  const hasUsableDevice = devices.some((d) => d.connected);
  // 一度つないだ機器があるときは、ボタンの意味が「選び直す」に変わる
  const hasChosenDevice = bluetooth.status === "connected" || bluetooth.status === "disconnected";

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

      {/* Bluetooth キーボードの直接接続(仕様書 F-10)。Web MIDI の許可状態とは無関係に表示する */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #3b3b52" }}>
        {bluetooth.supported ? (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={bluetooth.connect}
                disabled={bluetooth.status === "connecting"}
                style={bluetooth.status === "connecting" ? disabledButtonStyle : buttonStyle}
              >
                {hasChosenDevice ? "別の機器を選ぶ" : "Bluetooth で接続"}
              </button>

              {bluetooth.status === "connecting" && (
                <span style={{ color: "#ffb300" }}>接続中…(キーボードの電源を確認)</span>
              )}

              {bluetooth.status === "connected" && (
                <span style={{ color: "#8bc34a" }}>
                  Bluetooth: {bluetooth.deviceName} に接続中
                </span>
              )}

              {bluetooth.status === "disconnected" && (
                <>
                  <span style={{ color: "#ffb300" }}>
                    Bluetooth: {bluetooth.deviceName} が切断中
                  </span>
                  <button onClick={bluetooth.reconnect} style={buttonStyle}>
                    再接続
                  </button>
                </>
              )}
            </div>

            {bluetooth.status === "error" && (
              <p style={{ margin: "6px 0 0", color: "#ff8a80" }}>{bluetooth.errorMessage}</p>
            )}

            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#999" }}>
              タブレット(Android)で Bluetooth キーボードを使うときは、上の「Bluetooth で接続」を押し、
              出てくる一覧からキーボードを選んでください(OS のペアリングだけでは、
              ブラウザからキーボードが見えません)。
              アプリを開き直すたびに選び直しが必要です。
              一覧に出ないときは、キーボードの電源が入っているか、
              ほかの端末やアプリにつながっていないかを確認してください。
            </p>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: "#999" }}>
            このブラウザは Bluetooth での直接接続に対応していません(Android では Chrome をお使いください)。
          </p>
        )}
      </div>

      {/* Windows / Mac 向けの接続ガイド(仕様書 3.1)。従来どおり、許可を得たあとに表示する */}
      {status === "granted" && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#999" }}>
          Windows / Mac でキーボードが一覧に出ない場合は、「再検索」を押すか、
          OS の Bluetooth 設定でペアリングを確認してください。
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

/** 接続中は二重に押せないようにする */
const disabledButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.5,
  cursor: "default",
};
