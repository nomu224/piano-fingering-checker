// 楽譜ファイルの追加 UI(仕様書 F-09)
//
// 運指付きの MusicXML(非圧縮)を選ぶと、変換して曲一覧に追加する。
// 変換には CLI と同じロジック(src/songs/musicxml.ts)を使うため、結果は必ず一致する。
// 読み込んだ曲はブラウザに保存され、次回起動時も選べる(端末内のみ。外部送信なし)。

import { useRef, useState } from "react";
import { resumeAudio } from "../audio/audioContext";
import type { Song } from "../core/types";
import { convertMusicXml, MusicXmlConvertError } from "../songs/musicxml";
import { addUserSong, makeUniqueId, makeUniqueTitle, removeUserSong } from "../songs/userSongs";

interface Props {
  /** 現在の全曲(内蔵 + 追加)。ID・曲名の重複回避に使う */
  allSongs: readonly Song[];
  /** 追加できたときに呼ぶ(親が一覧を更新し、その曲を選択する) */
  onAdded: (song: Song) => void;
  /** 削除したときに呼ぶ */
  onRemoved: (id: string) => void;
  /** 選択中の曲(追加曲なら削除ボタンを出す) */
  selectedSong: Song;
  /** 選択中の曲が追加曲か */
  selectedIsUserSong: boolean;
}

/** ファイルの中身から、MusicXML 以外の紛らわしいファイルを見分ける */
function detectUnsupported(name: string, head: Uint8Array): string | null {
  const lower = name.toLowerCase();

  // 圧縮 MusicXML(.mxl)は ZIP。MuseScore の書き出し既定がこれなので最も間違えやすい
  const isZip =
    head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (lower.endsWith(".mxl") || isZip) {
    return "圧縮された MusicXML(.mxl)には対応していません。MuseScore の「エクスポート」で、形式に「MusicXML」を選び、圧縮なし(.musicxml)で書き出してください。";
  }

  // MIDI ファイル(先頭が MThd)。運指情報を持てないため使えない(仕様書 2.2)
  const isMidi =
    head[0] === 0x4d && head[1] === 0x54 && head[2] === 0x68 && head[3] === 0x64;
  if (lower.endsWith(".mid") || lower.endsWith(".midi") || isMidi) {
    return "MIDI ファイルには運指(指番号)の情報が入らないため使えません。MuseScore から MusicXML(非圧縮)で書き出したファイルを選んでください。";
  }

  return null;
}

/**
 * エラーを利用者向けの日本語メッセージにする。
 * XML パーサーの内部エラー(英語で分かりにくい)はそのまま出さず、何をすればよいかを示す。
 */
function toFriendlyError(e: unknown): string {
  // 変換処理が原因を特定できたエラーは、そのメッセージをそのまま見せる。
  // ※ XML パーサー内部のエラーはファイルの中身(日本語を含むことがある)を
  //   そのまま載せてくるため、文字種ではなく型で見分ける
  if (e instanceof MusicXmlConvertError) {
    return `読み込めませんでした: ${e.message}`;
  }
  return "このファイルは MusicXML として読み取れませんでした。MuseScore の「エクスポート」から、形式に「MusicXML」を選び、圧縮なし(.musicxml)で書き出したファイルを選んでください。";
}

export function SongImport({
  allSongs,
  onAdded,
  onRemoved,
  selectedSong,
  selectedIsUserSong,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [info, setInfo] = useState("");

  const handleFile = async (file: File) => {
    setError("");
    setWarnings([]);
    setInfo("");

    // ファイル選択ダイアログから戻るとページが一時的に背面に回り、
    // ブラウザが音を止めることがあるため鳴らせる状態に戻す(F-08)
    resumeAudio();

    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const unsupported = detectUnsupported(file.name, head);
      if (unsupported) {
        setError(unsupported);
        return;
      }

      const text = await file.text();

      // 曲名はファイル名を優先する(MuseScore の曲名は初期値「無題のスコア」のことが多いため)
      const baseTitle = file.name.replace(/\.(musicxml|xml)$/i, "") || "無題";
      const { song, warnings: convertWarnings } = convertMusicXml(text, {
        // ID は必ず一意にする(同じ ID だと前の曲を上書きしてしまう)
        id: makeUniqueId(allSongs.map((s) => s.id)),
        title: makeUniqueTitle(baseTitle, allSongs.map((s) => s.title)),
        difficulty: 1,
      });

      addUserSong(song);
      setWarnings(convertWarnings);
      setInfo(`「${song.title}」を追加しました(${song.events.length} イベント)`);
      onAdded(song);
    } catch (e) {
      setError(toFriendlyError(e));
    } finally {
      // 同じファイルをもう一度選べるように値をクリアする
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = () => {
    try {
      removeUserSong(selectedSong.id);
      setError("");
      setWarnings([]);
      setInfo(`「${selectedSong.title}」を削除しました`);
      onRemoved(selectedSong.id);
    } catch (e) {
      setError(`削除に失敗しました: ${String(e)}`);
    }
  };

  return (
    <div style={{ fontSize: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => inputRef.current?.click()} style={buttonStyle}>
          楽譜を追加(MusicXML)
        </button>
        {selectedIsUserSong && (
          <button onClick={handleRemove} style={buttonStyle}>
            この曲を削除
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".musicxml,.xml"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>

      {info && <p style={{ margin: "6px 0 0", color: "#8bc34a" }}>{info}</p>}

      {warnings.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 20, color: "#ffb300" }}>
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {error && (
        <p style={{ margin: "6px 0 0", color: "#ff8a80", maxWidth: 640 }}>{error}</p>
      )}
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "6px 16px",
  fontSize: 14,
  background: "#3b3b52",
  color: "#eee",
  border: "1px solid #666",
  borderRadius: 6,
  cursor: "pointer",
};
