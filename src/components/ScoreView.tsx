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

/** 読み込んだ OSMD の型(型だけの import は実行時のコードを生まないので安全) */
type Osmd = import("opensheetmusicdisplay").OpenSheetMusicDisplay;

interface Props {
  /** 表示する楽譜。null なら楽譜なし(呼び出し側が従来表示に戻す) */
  musicXml: string | null;
  /** 楽譜の拡大率(小さい画面では 0.5〜0.7 程度) */
  zoom?: number;
}

/** 読み込み・描画の状態 */
type ScoreState = "idle" | "loading" | "ready" | "error";

export function ScoreView({ musicXml, zoom = 0.6 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<Osmd | null>(null);
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
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [musicXml, zoom]);

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
