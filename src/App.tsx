// アプリ本体
// P1〜P4 時点では動作確認用の画面を仮タブで切り替えて表示する。
// S-01〜S-06 の正式な画面遷移は後続フェーズで実装する。
// キャリブレーション結果は App が保持し、P3(ウィザード)→ P4(練習)へ受け渡す。
import { useEffect, useState } from "react";
import { getAudioContext, isAudioRunning, resumeAudio } from "./audio/audioContext";
import { getReferenceTone } from "./audio/referenceTone";
import { CalibrationDebug } from "./components/CalibrationDebug";
import { CameraDebug } from "./components/CameraDebug";
import { PracticeDebug } from "./components/PracticeDebug";
import { PracticeScreen, type CalibrationInfo } from "./components/PracticeScreen";
import { useMidiDevices } from "./components/useMidiDevices";
import { DEFAULT_SETTINGS } from "./core/constants";
import type { PracticeSettings } from "./core/types";

type DebugTab = "practice-p1" | "camera" | "calibration" | "practice";

export default function App() {
  const [tab, setTab] = useState<DebugTab>("practice");
  // キャリブレーション結果(F-03: メモリ内のみ保持。保存しない)
  const [calibrationInfo, setCalibrationInfo] = useState<CalibrationInfo | null>(null);
  // 練習の設定(F-07: メモリ内のみ保持)
  const [settings, setSettings] = useState<PracticeSettings>(DEFAULT_SETTINGS);
  // MIDI デバイスの選択(F-01)。タブ切替や画面の再マウントで選択が消えないよう App が保持する
  const midi = useMidiDevices();
  // 音を出せる状態か(ブラウザの自動再生制限。false の間は案内を出す)
  const [audioReady, setAudioReady] = useState(false);

  // 参照音(F-08)のための音の準備。
  // AudioContext は起動時に 1 度だけ生成し、resume だけを最初のユーザー操作に紐づける。
  // ※ MIDI メッセージの受信はユーザー操作として扱われないため、画面を一度も触らずに
  //   実鍵盤を弾くと suspended のままで無音になる。それを解除するための導線。
  useEffect(() => {
    getAudioContext(); // 起動時に生成(state は suspended のことがある)
    setAudioReady(isAudioRunning());

    const unlock = () => {
      resumeAudio();
      // resume は非同期なので少し待ってから状態を見る
      setTimeout(() => setAudioReady(isAudioRunning()), 100);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    // 押しっぱなしでタブを離れたときに音が残らないようにする
    const stopAll = () => getReferenceTone().stopAll();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopAll();
    };
    window.addEventListener("blur", stopAll);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("blur", stopAll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

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
      {/* 音がまだ有効になっていないときの案内(F-08。実鍵盤だけでは解除されないため) */}
      {!audioReady && (
        <div
          style={{
            background: "#3e3a26",
            color: "#ffd54f",
            padding: "8px 12px",
            borderRadius: 8,
            marginBottom: 8,
            fontSize: 14,
          }}
        >
          🔇 音を出すには、画面を一度タップ(クリック)してください
        </div>
      )}
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
          midi={midi}
          onCalibrated={(calibration, deviceId) =>
            setCalibrationInfo({ calibration, deviceId })
          }
        />
      )}
      {tab === "practice" && (
        <PracticeScreen
          calibrationInfo={calibrationInfo}
          settings={settings}
          onChangeSettings={setSettings}
          midi={midi}
        />
      )}
    </div>
  );
}
