// スコアフォロー(譜面追従)エンジン(仕様書 7.1)
//
// テンポは評価しないため、MIDI 入力主導で譜面上のカーソルを進める方式。
// UI・ブラウザ API には一切依存しない純 TypeScript(テスト対象)。

import { SKIP_SEARCH_RANGE } from "./constants";
import type { NoteOnResult, ScoreEvent, Song } from "./types";

export class ScoreFollower {
  private readonly song: Song;

  /** 現在の譜面カーソル(次に演奏すべきイベントの index) */
  private cursor = 0;

  /** 現イベント内で達成済みの構成音(ノート番号の集合)。和音の順不同達成の管理用 */
  private achieved = new Set<number>();

  /** 同一カーソル位置での連続音ミス数(正解で 0 に戻る)。弾き飛ばし救済の発動判定用 */
  private consecutiveMisses = 0;

  /** 演奏終了フラグ(最終イベント達成で true) */
  private finished = false;

  constructor(song: Song) {
    if (song.events.length === 0) {
      throw new Error("イベントが空の楽曲はスコアフォローできません");
    }
    this.song = song;
  }

  /**
   * Note On 1 回を処理し、判定結果を返す(仕様書 7.1)。
   * @param midi 押されたノート番号
   * @param _timestampMs 打鍵時刻(ms)。P1 では未使用。P3 以降で
   *   ランドマーク履歴との突き合わせ(仕様書 7.2)に使うため受け口だけ用意する
   */
  processNoteOn(midi: number, _timestampMs?: number): NoteOnResult {
    const event = this.song.events[this.cursor];

    // 演奏終了後の打鍵は達成済み扱いで無視する(結果画面遷移までの余分な打鍵対策)
    if (this.finished) {
      return { type: "duplicateIgnored", eventIndex: event.index, playedMidi: midi };
    }

    // 1) 現イベントの「未達成」構成音と一致 → 正解
    const matched = event.notes.find(
      (n) => n.midi === midi && !this.achieved.has(n.midi),
    );
    if (matched) {
      this.achieved.add(midi);
      this.consecutiveMisses = 0;

      // 全構成音が達成されたらカーソルを進める(同時押しでなく順に押しても良い)
      const completed = event.notes.every((n) => this.achieved.has(n.midi));
      if (completed) {
        if (this.cursor === this.song.events.length - 1) {
          // 最終イベントの達成をもって演奏終了(仕様書 7.1「曲の終了」)
          this.finished = true;
          return { type: "finished", eventIndex: event.index, note: matched };
        }
        this.cursor++;
        this.achieved.clear();
        return {
          type: "correct",
          eventIndex: event.index,
          note: matched,
          eventCompleted: true,
        };
      }
      return {
        type: "correct",
        eventIndex: event.index,
        note: matched,
        eventCompleted: false,
      };
    }

    // 2) 達成済みの構成音と同じ音の再打鍵 → 無視(ミスにしない。達成マークもリセットしない)
    if (event.notes.some((n) => n.midi === midi)) {
      return { type: "duplicateIgnored", eventIndex: event.index, playedMidi: midi };
    }

    // 3) 構成音以外の音 → 音ミス(カーソルは進めない。達成マークはリセットしない)
    this.consecutiveMisses++;

    // 弾き飛ばし救済(仕様書 7.1):
    // 同一カーソル位置で 2 回連続音ミスが発生した時点で、直後 N イベント以内に
    // 「直近のミス音(=今回の音)」と一致する音を探索する。
    // この救済は単音イベントのみ対象(発動元・ジャンプ先とも。和音イベントには適用しない)。
    if (this.consecutiveMisses >= 2 && event.notes.length === 1) {
      const jumpTarget = this.findSkipJumpTarget(midi);
      if (jumpTarget !== null) {
        // 詰まっていた現在イベント自身を含む、ジャンプ先手前までを「スキップ(未演奏)」として記録
        const skipped: number[] = [];
        for (let i = this.cursor; i < jumpTarget; i++) {
          skipped.push(this.song.events[i].index);
        }

        const targetEvent = this.song.events[jumpTarget];
        const targetNote = targetEvent.notes[0];
        this.consecutiveMisses = 0;
        this.achieved.clear();

        // この打鍵でジャンプ先イベントを達成扱いにする(弾き直し不要)。
        // ※ この打鍵自体は仕様の文言どおり「音ミスとして記録」される(集計は呼び出し側)。
        if (jumpTarget === this.song.events.length - 1) {
          this.finished = true;
          this.cursor = jumpTarget;
          return {
            type: "finished",
            eventIndex: targetEvent.index,
            note: targetNote,
            skippedEventIndices: skipped,
          };
        }
        this.cursor = jumpTarget + 1;
        return {
          type: "skipJump",
          playedMidi: midi,
          missEventIndex: event.index,
          jumpedToEventIndex: targetEvent.index,
          skippedEventIndices: skipped,
          note: targetNote,
        };
      }
    }

    return { type: "wrongNote", eventIndex: event.index, playedMidi: midi };
  }

  /**
   * 弾き飛ばし救済のジャンプ先を探す。
   * 現カーソルの直後 SKIP_SEARCH_RANGE イベント以内で、ミス音と一致する
   * 「単音イベント」の index を返す(和音イベントは候補にしない)。無ければ null。
   */
  private findSkipJumpTarget(missMidi: number): number | null {
    const limit = Math.min(
      this.cursor + SKIP_SEARCH_RANGE,
      this.song.events.length - 1,
    );
    for (let i = this.cursor + 1; i <= limit; i++) {
      const candidate = this.song.events[i];
      if (candidate.notes.length === 1 && candidate.notes[0].midi === missMidi) {
        return i;
      }
    }
    return null;
  }

  /** 進行状態を最初に戻す(やり直し用) */
  reset(): void {
    this.cursor = 0;
    this.achieved.clear();
    this.consecutiveMisses = 0;
    this.finished = false;
  }

  /** 現在のカーソル(次に演奏すべきイベントの index)。終了後は最終イベントを指す */
  getCursor(): number {
    return this.cursor;
  }

  /** 次に演奏すべきイベント */
  getCurrentEvent(): ScoreEvent {
    return this.song.events[this.cursor];
  }

  /** 現イベント内で達成済みのノート番号(和音の進捗表示用) */
  getAchievedMidis(): ReadonlySet<number> {
    return this.achieved;
  }

  /** 演奏が終了したか */
  isFinished(): boolean {
    return this.finished;
  }

  getSong(): Song {
    return this.song;
  }
}
