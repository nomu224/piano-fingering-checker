// Bluetooth 接続のエラーを分かりやすい日本語にする(仕様書 F-10 / 10 章)
//
// UI・ブラウザ API に依存しない純 TypeScript(テスト対象)。

/** エラーが起きた段階。同じ NotFoundError でも意味が違うため区別する */
export type BleConnectStage =
  /** 機器選択の画面を出している段階 */
  | "choose"
  /** 機器を選んだあと、接続してデータの受信を始めるまでの段階 */
  | "connect";

/** エラーの名前を取り出す(DOMException 以外でも落ちないように) */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

/**
 * エラー → 画面に出すメッセージ。
 * null を返したら「エラーとして表示しない」(利用者が自分で選択画面を閉じた場合)。
 */
export function toBleErrorMessage(error: unknown, stage: BleConnectStage): string | null {
  const name = errorName(error);
  const text = error instanceof Error ? error.message : String(error);

  if (name === "SecurityError" || name === "NotAllowedError") {
    return "Bluetooth の使用が許可されていません。ブラウザに「付近のデバイス」(古い Android では位置情報)の許可を与えてから、もう一度お試しください。";
  }

  if (name === "NotFoundError") {
    if (stage === "choose") {
      // 「機器が選ばれなかった」= 利用者が選択画面を閉じた場合と、
      // そもそも Bluetooth が使えない場合の両方がこの名前になる。
      // メッセージの文面で見分ける。※ Chrome が文面を変えたら見分けられなくなるが、
      //   そのときは「何も表示しない」に倒れるだけなので害はない。
      if (/bluetooth adapter|globally disabled|not available/i.test(text)) {
        return "この端末では Bluetooth が使えません。端末の Bluetooth が入っているか確認してください。";
      }
      return null; // 利用者が選択画面を閉じただけ
    }
    // 機器を選んだあとで見つからない = MIDI のサービスが無い機器だった
    return "この機器は Bluetooth MIDI に対応していないようです。別の機器を選んでください。";
  }

  if (name === "NetworkError") {
    return "キーボードに接続できませんでした。電源が入っているか、近くにあるか、ほかの端末やアプリにつながっていないかを確認して、もう一度お試しください。";
  }

  if (name === "NotSupportedError") {
    return "このブラウザ・端末では Bluetooth MIDI を使えません。Chrome をお使いください。";
  }

  return `Bluetooth での接続に失敗しました: ${text || String(error)}`;
}
