// 楽譜(MusicXML)の保管(仕様書 F-11 / 8.1)
//
// 楽譜表示には、変換後の JSON ではなく**元の MusicXML** が必要になる
// (JSON は判定に必要な情報だけを持ち、音の長さ・休符・拍子を捨てているため)。
//
// 曲データ(Song)には XML を入れない。判定エンジンが使う型を表示専用の情報で太らせないため、
// 「曲 ID → MusicXML」をこのファイルだけで管理する。
//
// - 内蔵曲: リポジトリの gakufu/*.musicxml を読み込む(builtinMusicXml)
// - 追加曲(F-09): localStorage に**曲ごとの別キー**で保存する
//   (全曲を 1 つのキーにまとめると、起動のたびに全部の XML を読むことになり、
//    1 曲の保存失敗で全曲が保存できなくなるため)

// gakufu/ の楽譜をそのまま文字列として読み込む(Vite の ?raw)。
// コピーを作らないのは、変換テストが gakufu/ の方を見ているため(正本を 1 つに保つ)。
import kakkouXml from "../../gakufu/kakkou.musicxml?raw";
import londonBridgeXml from "../../gakufu/ロンドン橋.musicxml?raw";

/** 追加曲の XML を保存するキーの接頭辞 */
const XML_KEY_PREFIX = "piano-fingering-checker:song-xml:";

/**
 * 1 曲あたりの XML の上限(文字数)。
 * localStorage は 1 文字あたり約 2 バイト消費するため、50 万文字 ≒ 1MB。
 * 保存領域は 5MB 程度しかないので、極端に大きな楽譜は保存しない
 * (楽譜表示ができないだけで、練習はできる。仕様書 F-11)。
 */
export const MAX_MUSIC_XML_LENGTH = 500_000;

/**
 * localStorage を安全に取得する(userSongs.ts と同じ流儀)。
 * プライベートモードでは参照自体が例外になるため、使うときに取得する。
 */
function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 内蔵曲の楽譜。
 * 【重要】曲を増やすときは src/songs/index.ts のレジストリとここの両方に足すこと
 * (片方だけだと「曲は増えたのに楽譜だけ出ない」状態になる)。
 * ファイルは gakufu/ のものを直接読む(コピーを作ると正本が 2 つになり、
 * 変換テストが見ている元ファイルと食い違うため)。
 */
export const builtinMusicXml: Readonly<Record<string, string>> = {
  // doremi(テスト曲)は手書きの JSON で、元の MusicXML が存在しないため楽譜表示に対応しない
  kakkou: kakkouXml,
  "london-bridge": londonBridgeXml,
};

/** 曲 ID の XML を取り出す(無ければ null) */
export function getSongMusicXml(songId: string): string | null {
  const builtin = builtinMusicXml[songId];
  if (builtin) return builtin;

  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(XML_KEY_PREFIX + songId);
  } catch {
    return null;
  }
}

/** 楽譜表示に対応している曲か(UI の案内に使う) */
export function hasSongMusicXml(songId: string): boolean {
  return getSongMusicXml(songId) !== null;
}

/**
 * 追加曲の XML を保存する。
 * 保存できなくても**曲データ自体は保存して練習できる**ようにするため、
 * 例外は投げずに成否を返す(仕様書 F-11)。
 */
export function saveUserSongMusicXml(songId: string, xml: string): boolean {
  if (xml.length > MAX_MUSIC_XML_LENGTH) return false;
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(XML_KEY_PREFIX + songId, xml);
    return true;
  } catch {
    // 容量超過など。楽譜は諦めて練習できる状態を優先する
    return false;
  }
}

/** 追加曲の XML を削除する(曲を削除したとき) */
export function removeUserSongMusicXml(songId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(XML_KEY_PREFIX + songId);
  } catch {
    // 消せなくても実害はない
  }
}

/**
 * 曲一覧に存在しない XML を掃除する。
 * 保存に失敗したときや、古いデータが残ったときに容量を食い続けないようにするため、
 * 曲一覧を読み込むタイミングで呼ぶ。
 */
export function cleanUpOrphanMusicXml(existingSongIds: readonly string[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const orphans: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(XML_KEY_PREFIX)) continue;
      const songId = key.slice(XML_KEY_PREFIX.length);
      if (!existingSongIds.includes(songId)) orphans.push(key);
    }
    orphans.forEach((key) => storage.removeItem(key));
  } catch {
    // 掃除できなくても実害はない
  }
}
