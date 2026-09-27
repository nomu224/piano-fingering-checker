// 複数の入力源を 1 つにまとめる(仕様書 F-02 / F-10)
//
// Web MIDI の入力と Bluetooth MIDI の入力を、1 つの MidiSource に見せる。
// 画面側(練習・キャリブレーション)はこれを購読するだけで、どちらからの Note On/Off も受け取れる。
// UI・ブラウザ API に依存しない純 TypeScript(テスト対象)。

import type { MidiSource, NoteHandler } from "./types";

export class CompositeMidiSource implements MidiSource {
  private sources: readonly MidiSource[];

  constructor(sources: readonly MidiSource[]) {
    this.sources = sources;
  }

  /** すべての入力源に登録する。戻り値を呼ぶと、すべての入力源から解除する */
  addNoteOnListener(handler: NoteHandler): () => void {
    const removers = this.sources.map((s) => s.addNoteOnListener(handler));
    return () => removers.forEach((remove) => remove());
  }

  addNoteOffListener(handler: NoteHandler): () => void {
    const removers = this.sources.map((s) => s.addNoteOffListener(handler));
    return () => removers.forEach((remove) => remove());
  }
}
