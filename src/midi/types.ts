// MIDI 入力源の共通インターフェース(仕様書 F-02)
//
// バーチャル MIDI キーボードと実 MIDI デバイス(P4 以降で midiInput.ts として実装)は
// どちらもこのインターフェースを実装し、判定エンジン側は入力源を区別しない。

/** Note On / Note Off 1 回分のメッセージ */
export interface NoteMessage {
  /** MIDI ノート番号(60 = 中央のド) */
  note: number;
  /** 発生時刻(ms、performance.now() 基準)。P3 のランドマーク履歴突き合わせに使う */
  timestampMs: number;
}

export type NoteHandler = (msg: NoteMessage) => void;

/** MIDI 入力源(実デバイス・バーチャル共通) */
export interface MidiSource {
  /** Note On リスナーを登録する。戻り値は登録解除関数 */
  addNoteOnListener(handler: NoteHandler): () => void;
  /** Note Off リスナーを登録する。戻り値は登録解除関数 */
  addNoteOffListener(handler: NoteHandler): () => void;
}
