// アプリ全体で共有する AudioContext(仕様書 F-08)
//
// F-08: 「AudioContext はアプリ起動時に 1 度だけ生成し、Note On のたびに再生成しない」
//
// 【生成と resume を分ける理由】
// new AudioContext() は自動再生ポリシー下でも例外を投げず、state: "suspended" で作られるだけ。
// 禁止されているのは「音を出すこと」であって「生成」ではない。
// 遅延生成にすると最初の Note On でオーディオグラフの初期化(数〜数十 ms)が走り、
// F-08 が最小化したい「最初の一音の遅延」がかえって最大になる。
// そのため生成は起動時に行い、resume() だけをユーザー操作に紐づける。
//
// 【重要】この AudioContext は close しない。
// close した AudioContext は resume できず、アプリ全体が以後無音になるため。

let ctx: AudioContext | null = null;

/** 共有 AudioContext を返す(初回呼び出し時に生成。以降は同じインスタンス) */
export function getAudioContext(): AudioContext {
  // closed になっていたら作り直す(通常は起こらないが保険)
  if (ctx === null || ctx.state === "closed") {
    ctx = new AudioContext({ latencyHint: "interactive" });
  }
  return ctx;
}

/**
 * 音を出せる状態にする(ブラウザの自動再生制限の解除)。
 *
 * 【重要】MIDI メッセージの受信はユーザー操作として扱われないため、
 * ページを開いてから一度も画面を触らずに実鍵盤を弾くと suspended のままで無音になる。
 * そのため App 側で最初のタップ/キー入力を捉えてこれを呼ぶ。
 *
 * Promise は await しない(Note On の処理をブロックしないため)。
 */
export function resumeAudio(): void {
  const context = getAudioContext();
  if (context.state !== "running") {
    void context.resume();
  }
}

/** 音が出せる状態か(「画面をタップしてください」の案内を出す判定に使う) */
export function isAudioRunning(): boolean {
  return ctx !== null && ctx.state === "running";
}

/**
 * オーディオ出力の遅延(秒)。デバッグ表示用。
 * Windows では数十 ms 乗ることがあり、仕様書 10 章の遅延の実測材料になる。
 */
export function getAudioLatency(): { base: number; output: number } {
  const context = getAudioContext();
  return {
    base: context.baseLatency ?? 0,
    // outputLatency は一部ブラウザで未実装
    output: (context as AudioContext & { outputLatency?: number }).outputLatency ?? 0,
  };
}
