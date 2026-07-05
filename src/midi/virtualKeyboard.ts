// バーチャル MIDI キーボード(仕様書 F-02)
//
// 画面上の鍵盤 UI(クリック/タップ)と PC キーボード操作から Note On/Off を発生させ、
// 実 MIDI デバイスと同じ MidiSource インターフェースで判定エンジンに渡す。
// DOM イベントの購読はコンポーネント側(VirtualKeyboard.tsx)で行い、
// このクラス自体は DOM に依存しない。

import type { MidiSource, NoteHandler, NoteMessage } from "./types";

/**
 * PC キーボードのキー → 表示範囲の最低音からの半音数。
 * ピアノの白鍵/黒鍵の並びを模した一般的な配置(README に記載)。
 * A=ド, W=ド♯, S=レ, E=レ♯, D=ミ, F=ファ, T=ファ♯, G=ソ, Y=ソ♯, H=ラ, U=ラ♯, J=シ, K=高いド
 */
export const KEY_TO_SEMITONE: Readonly<Record<string, number>> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
};

/** 表示範囲(2 オクターブ)の最低音の可動域。61 鍵キーボード(A0基準)相当の範囲に収める */
const MIN_BASE_NOTE = 36; // C2
const MAX_BASE_NOTE = 84; // C6

/** 音名表示用(ドレミ表記。デバッグ画面・鍵盤ラベルで使う) */
const NOTE_NAMES_JA = ["ド", "ド♯", "レ", "レ♯", "ミ", "ファ", "ファ♯", "ソ", "ソ♯", "ラ", "ラ♯", "シ"] as const;

/** MIDI ノート番号を「ド4」のような表示名に変換する(60 = ド4) */
export function noteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES_JA[midi % 12]}${octave}`;
}

export class VirtualMidiKeyboard implements MidiSource {
  /** 表示範囲(2 オクターブ)の最低音。オクターブシフト ± で 12 ずつ動く。初期値は中央のド */
  private baseNote = 60;

  /** 現在押下中のノート(多重 Note On の防止と、シフト中でも正しい Note Off を送るため) */
  private activeNotes = new Set<number>();

  /** PC キー → そのキーで発音中のノート番号(押下中にシフトしても正しく Note Off するため) */
  private keyToActiveNote = new Map<string, number>();

  private noteOnHandlers = new Set<NoteHandler>();
  private noteOffHandlers = new Set<NoteHandler>();

  // ---- MidiSource 実装 ----

  addNoteOnListener(handler: NoteHandler): () => void {
    this.noteOnHandlers.add(handler);
    return () => this.noteOnHandlers.delete(handler);
  }

  addNoteOffListener(handler: NoteHandler): () => void {
    this.noteOffHandlers.add(handler);
    return () => this.noteOffHandlers.delete(handler);
  }

  // ---- 鍵盤 UI から呼ぶ ----

  /** 鍵盤 UI のクリック/タップによる Note On */
  noteOn(note: number, timestampMs: number = performance.now()): void {
    if (this.activeNotes.has(note)) return; // 押しっぱなし中の多重発音は無視
    this.activeNotes.add(note);
    const msg: NoteMessage = { note, timestampMs };
    this.noteOnHandlers.forEach((h) => h(msg));
  }

  /** 鍵盤 UI のリリースによる Note Off */
  noteOff(note: number, timestampMs: number = performance.now()): void {
    if (!this.activeNotes.delete(note)) return;
    const msg: NoteMessage = { note, timestampMs };
    this.noteOffHandlers.forEach((h) => h(msg));
  }

  // ---- PC キーボードから呼ぶ(DOM イベントの購読はコンポーネント側) ----

  /**
   * PC キーの押下。割当キーなら Note On を発生させ true を返す。
   * キーリピート(押しっぱなし)は呼び出し側で e.repeat を見て除外すること。
   */
  keyDown(key: string): boolean {
    const semitone = KEY_TO_SEMITONE[key.toLowerCase()];
    if (semitone === undefined) return false;
    if (this.keyToActiveNote.has(key.toLowerCase())) return true; // 既に押下中
    const note = this.baseNote + semitone;
    this.keyToActiveNote.set(key.toLowerCase(), note);
    this.noteOn(note);
    return true;
  }

  /** PC キーのリリース。割当キーなら Note Off を発生させ true を返す */
  keyUp(key: string): boolean {
    const note = this.keyToActiveNote.get(key.toLowerCase());
    if (note === undefined) return false;
    this.keyToActiveNote.delete(key.toLowerCase());
    this.noteOff(note);
    return true;
  }

  // ---- オクターブシフト(仕様書 F-02: バイエル両手曲の低音域テストに必要) ----

  /** オクターブシフト(delta = +1 / -1) */
  shiftOctave(delta: 1 | -1): void {
    const next = this.baseNote + delta * 12;
    if (next < MIN_BASE_NOTE || next > MAX_BASE_NOTE) return;
    this.baseNote = next;
  }

  /** 表示範囲(2 オクターブ)の最低音 */
  getBaseNote(): number {
    return this.baseNote;
  }
}
