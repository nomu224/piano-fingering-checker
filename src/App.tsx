// アプリ本体
// P1 時点では動作確認用のデバッグ画面(PracticeDebug)のみを表示する。
// S-01〜S-06 の正式な画面遷移は後続フェーズで実装する。
import { PracticeDebug } from "./components/PracticeDebug";

export default function App() {
  return <PracticeDebug />;
}
