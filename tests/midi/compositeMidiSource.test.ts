// 入力源をまとめる CompositeMidiSource(仕様書 F-02 / F-10)のユニットテスト
import { describe, expect, it } from "vitest";
import { CompositeMidiSource } from "../../src/midi/compositeMidiSource";
import type { NoteMessage } from "../../src/midi/types";
import { VirtualMidiKeyboard } from "../../src/midi/virtualKeyboard";

describe("CompositeMidiSource", () => {
  it("どの入力源からの Note On / Note Off も購読者に届く", () => {
    const a = new VirtualMidiKeyboard();
    const b = new VirtualMidiKeyboard();
    const composite = new CompositeMidiSource([a, b]);
    const ons: NoteMessage[] = [];
    const offs: NoteMessage[] = [];
    composite.addNoteOnListener((m) => ons.push(m));
    composite.addNoteOffListener((m) => offs.push(m));

    a.noteOn(60, 1);
    b.noteOn(64, 2);
    a.noteOff(60, 3);
    b.noteOff(64, 4);

    expect(ons).toEqual([
      { note: 60, timestampMs: 1 },
      { note: 64, timestampMs: 2 },
    ]);
    expect(offs).toEqual([
      { note: 60, timestampMs: 3 },
      { note: 64, timestampMs: 4 },
    ]);
  });

  it("解除すると、どの入力源からも届かなくなる", () => {
    const a = new VirtualMidiKeyboard();
    const b = new VirtualMidiKeyboard();
    const composite = new CompositeMidiSource([a, b]);
    const received: number[] = [];
    const removeOn = composite.addNoteOnListener((m) => received.push(m.note));
    const removeOff = composite.addNoteOffListener((m) => received.push(-m.note));

    removeOn();
    removeOff();
    a.noteOn(60, 1);
    b.noteOn(64, 2);
    a.noteOff(60, 3);

    expect(received).toEqual([]);
  });
});
