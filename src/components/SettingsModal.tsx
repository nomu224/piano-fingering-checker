// S-06 設定モーダル(仕様書 F-07)
//
// - フィードバック音の ON/OFF・音量
// - 正解時のクリック音(F-05「正解: 無音(または設定でクリック音)」)
// - 判定の厳しさ(指の判定不能を「無視」or「ミス扱い」)
// - 左手/右手/両手の判定対象切替(運指判定のみ。音判定は常に両手で進行する)
// 設定はメモリ内のみ保持(仕様に永続化の規定なし)。

import type { PracticeSettings } from "../core/types";

interface Props {
  settings: PracticeSettings;
  onChange: (next: PracticeSettings) => void;
  onClose: () => void;
}

export function SettingsModal({ settings, onChange, onClose }: Props) {
  const update = (patch: Partial<PracticeSettings>) =>
    onChange({ ...settings, ...patch });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        overflowY: "auto",
        zIndex: 100,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#2a2a3e",
          borderRadius: 12,
          padding: 20,
          maxWidth: 480,
          width: "100%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>設定(S-06)</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 14 }}>
          {/* フィードバック音(F-07) */}
          <label>
            <input
              type="checkbox"
              checked={settings.feedbackEnabled}
              onChange={(e) => update({ feedbackEnabled: e.target.checked })}
            />{" "}
            フィードバック音を鳴らす
          </label>

          <label>
            音量:{" "}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.feedbackVolume}
              disabled={!settings.feedbackEnabled}
              onChange={(e) => update({ feedbackVolume: Number(e.target.value) })}
              style={{ verticalAlign: "middle", width: 160 }}
            />{" "}
            {Math.round(settings.feedbackVolume * 100)}%
          </label>

          <label>
            <input
              type="checkbox"
              checked={settings.clickOnCorrect}
              disabled={!settings.feedbackEnabled}
              onChange={(e) => update({ clickOnCorrect: e.target.checked })}
            />{" "}
            正解のときにクリック音を鳴らす(既定は無音)
          </label>

          {/* 判定の厳しさ(F-07) */}
          <label>
            指が判定できなかったとき:{" "}
            <select
              value={settings.undeterminedAsMiss ? "miss" : "ignore"}
              onChange={(e) => update({ undeterminedAsMiss: e.target.value === "miss" })}
              style={{ fontSize: 14, padding: 4 }}
            >
              <option value="ignore">無視する(回数だけ数える)</option>
              <option value="miss">ミス扱いにする(厳しめ)</option>
            </select>
          </label>

          {/* 判定対象の手(F-07) */}
          <div>
            <label>
              運指判定の対象:{" "}
              <select
                value={settings.targetHands}
                onChange={(e) =>
                  update({ targetHands: e.target.value as PracticeSettings["targetHands"] })
                }
                style={{ fontSize: 14, padding: 4 }}
              >
                <option value="both">両手</option>
                <option value="R">右手のみ</option>
                <option value="L">左手のみ</option>
              </select>
            </label>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#999" }}>
              ※ 対象外の手も音判定は行われます(両手分を弾かないと曲は進みません)
            </p>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              background: "#5c6bc0",
              color: "#eee",
              border: "1px solid #666",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
