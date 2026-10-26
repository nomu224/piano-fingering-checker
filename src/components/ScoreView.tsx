// 楽譜の表示(仕様書 F-11)
//
// MusicXML を五線譜として描画する。描画には OpenSheetMusicDisplay を使う(仕様書 5 章)。
//
// 【方針】
// - OSMD への依存はこのファイルだけに閉じ込める(OSMD のインスタンスを外へ出さない)
// - OSMD は**動的 import** で読み込む。約 2.3MB あるため、楽譜を出すときだけ読み込む
//   (このファイルで静的 import をしてはいけない。起動時に読み込まれてしまう)
// - **楽譜が描けなくても練習は続けられる**(エラー時は案内だけ出す。仕様書 F-11)

import { useEffect, useRef, useState } from "react";
import { comparePosition, type ScorePosition } from "./scoreCursor";

/** 読み込んだ OSMD の型(型だけの import は実行時のコードを生まないので安全) */
type Osmd = import("opensheetmusicdisplay").OpenSheetMusicDisplay;
type GNote = import("opensheetmusicdisplay").GraphicalNote;

interface Props {
  /** 表示する楽譜。null なら楽譜なし(呼び出し側が従来表示に戻す) */
  musicXml: string | null;
  /** いま弾くべき位置(null ならハイライトを消す) */
  position?: ScorePosition | null;
  /** 楽譜の拡大率(小さい画面では 0.5〜0.7 程度) */
  zoom?: number;
}

/** 現在位置の音符に付ける色 */
const HIGHLIGHT_COLOR = "#e53935";
/** 元に戻すときの色(通常の音符の色) */
const NORMAL_COLOR = "#000000";
/** 色を付ける範囲(符頭・符尾・連桁・運指などの装飾) */
const COLORING_OPTIONS = {
  applyToNoteheads: true,
  applyToStem: true,
  applyToBeams: true,
  applyToFlag: true,
  applyToModifiers: true,
};

/** 読み込み・描画の状態 */
type ScoreState = "idle" | "loading" | "ready" | "error";

export function ScoreView({ musicXml, position = null, zoom = 0.6 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<Osmd | null>(null);
  // いま色を付けている音符(次の移動で元の色に戻すため覚えておく)
  const coloredRef = useRef<GNote[]>([]);
  const [state, setState] = useState<ScoreState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!musicXml) {
      setState("idle");
      return;
    }

    // 描画の途中でアンマウント・曲の切り替えが起きたら、古い結果を捨てる
    let cancelled = false;
    setState("loading");
    setErrorMessage("");

    const render = async () => {
      try {
        // OSMD は UMD 形式なので、名前空間の形が環境によって変わりうる
        const mod = await import("opensheetmusicdisplay");
        const OSMD = mod.OpenSheetMusicDisplay ?? mod.default?.OpenSheetMusicDisplay;
        if (cancelled || !containerRef.current) return;
        if (!OSMD) throw new Error("楽譜ライブラリを読み込めませんでした");

        const osmd: Osmd = new OSMD(containerRef.current, {
          autoResize: false, // サイズ変更は呼び出し側で制御する(無駄な再描画を避ける)
          // 画面が狭いので、曲名・作曲者・パート名は出さない(曲名は画面上部に別途出している)
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawLyricist: false,
          drawPartNames: false,
          drawFingerings: true, // 運指番号を表示する(このアプリの主題)
          backend: "svg",
        });
        osmd.zoom = zoom;

        await osmd.load(musicXml);
        if (cancelled) return;
        osmd.render();
        if (cancelled) return;

        osmdRef.current = osmd;
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        setState("error");
        setErrorMessage(`楽譜を表示できませんでした(練習は続けられます): ${String(e)}`);
      }
    };
    void render();

    return () => {
      cancelled = true;
      // 前の楽譜を片付ける(残すと次の楽譜と二重に表示される)
      osmdRef.current = null;
      coloredRef.current = [];
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [musicXml, zoom]);

  // 現在位置へカーソルを動かし、その音符に色を付ける(仕様書 F-11)
  useEffect(() => {
    const osmd = osmdRef.current;
    if (state !== "ready" || !osmd) return;
    const cursor = osmd.cursor;
    if (!cursor) return;

    // 前に色を付けた音符を元に戻す(戻し忘れると楽譜中が色だらけになる)
    coloredRef.current.forEach((note) => note.setColor(NORMAL_COLOR, COLORING_OPTIONS));
    coloredRef.current = [];

    if (!position) {
      cursor.hide();
      return;
    }

    // 走査中はカーソルを隠す。next() は 1 回ごとに表示を更新するため、
    // 戻るときに数百回の更新が一気に走るのを避ける
    cursor.hide();

    /** カーソルのいまの位置を、アプリ側と同じ形(小節インデックス + 四分音符単位)にする */
    const currentPosition = (): ScorePosition | null => {
      const iterator = cursor.iterator;
      const measure = iterator?.CurrentMeasure;
      if (!iterator || !measure) return null;
      // OSMD の時刻は「曲頭からの絶対時刻・全音符 = 1」。
      // 小節頭を引いて 4 倍すると、小節内の四分音符単位になる
      const inMeasure = iterator.currentTimeStamp.RealValue - measure.AbsoluteTimestamp.RealValue;
      return {
        measureIndex: iterator.CurrentMeasureIndex,
        onsetQuarters: inMeasure * 4,
      };
    };

    // 目的地より後ろにいるなら、先頭に戻してから進め直す
    const here = currentPosition();
    if (!here || comparePosition(here, position) > 0) cursor.reset();

    // 進めすぎを防ぐため、上限は楽譜の音符数から決める(固定値にしない)
    const maxSteps = (osmd.Sheet?.SourceMeasures?.length ?? 0) * 64 + 256;
    let found = false;
    for (let i = 0; i < maxSteps; i++) {
      const now = currentPosition();
      if (!now) break;
      const diff = comparePosition(now, position);
      if (diff === 0) {
        found = true;
        break;
      }
      if (diff > 0) break; // 通り過ぎた = 対応する音符が無い
      if (cursor.iterator?.EndReached) break;
      cursor.next();
    }

    if (!found) return; // 見つからないときは、誤った位置に色を残さない

    cursor.show();
    const notes = cursor.GNotesUnderCursor();
    notes.forEach((note) => note.setColor(HIGHLIGHT_COLOR, COLORING_OPTIONS));
    coloredRef.current = notes;

    // カーソルが見えていないときは、その位置までスクロールする
    cursor.cursorElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [position, state]);

  if (!musicXml) return null;

  return (
    <div className="score-view">
      {state === "loading" && (
        <p style={{ margin: 0, fontSize: 13, color: "#ffb300" }}>楽譜を読み込んでいます…</p>
      )}
      {state === "error" && (
        <p style={{ margin: 0, fontSize: 13, color: "#ff8a80" }}>{errorMessage}</p>
      )}
      <div ref={containerRef} className="score-canvas" />
    </div>
  );
}
