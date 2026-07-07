// アプリ本体
// P1〜P4 時点では動作確認用の画面を仮タブで切り替えて表示する。
// S-01〜S-06 の正式な画面遷移は後続フェーズで実装する。
// キャリブレーション結果は App が保持し、P3(ウィザード)→ P4(練習)へ受け渡す。
import { useState } from "react";
import { CalibrationDebug } from "./components/CalibrationDebug";
import { CameraDebug } from "./components/CameraDebug";
import { PracticeDebug } from "./components/PracticeDebug";
import { PracticeScreen, type CalibrationInfo } from "./components/PracticeScreen";

type DebugTab = "practice-p1" | "camera" | "calibration" | "practice";

export default function App() {
  const [tab, setTab] = useState<DebugTab>("practice");
  // キャリブレーション結果(F-03: メモリ内のみ保持。保存しない)
  const [calibrationInfo, setCalibrationInfo] = useState<CalibrationInfo | null>(null);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 16px",
    fontSize: 14,
    background: active ? "#5c6bc0" : "#3b3b52",
    color: "#eee",
    border: "1px solid #666",
    borderRadius: "6px 6px 0 0",
    cursor: "pointer",
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #666", marginBottom: 16, flexWrap: "wrap" }}>
        <button style={tabStyle(tab === "practice-p1")} onClick={() => setTab("practice-p1")}>
          P1: 判定エンジン確認
        </button>
        <button style={tabStyle(tab === "camera")} onClick={() => setTab("camera")}>
          P2: カメラ確認
        </button>
        <button style={tabStyle(tab === "calibration")} onClick={() => setTab("calibration")}>
          P3: キャリブレーション・指特定
        </button>
        <button style={tabStyle(tab === "practice")} onClick={() => setTab("practice")}>
          P4: 練習
        </button>
      </div>
      {tab === "practice-p1" && <PracticeDebug />}
      {tab === "camera" && <CameraDebug />}
      {tab === "calibration" && (
        <CalibrationDebug
          onCalibrated={(calibration, deviceId) =>
            setCalibrationInfo({ calibration, deviceId })
          }
        />
      )}
      {tab === "practice" && <PracticeScreen calibrationInfo={calibrationInfo} />}
    </div>
  );
}
