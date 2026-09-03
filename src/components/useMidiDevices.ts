// MIDI デバイスの検出・選択・接続管理(仕様書 F-01 / 3.1)
//
// このフックは App.tsx で 1 回だけ呼び、props で各画面へ配る。
// (タブ切替やキャリブレーション完了で画面が再マウントされても選択が消えないようにするため)

import { useCallback, useEffect, useRef, useState } from "react";
import { MidiDeviceInput } from "../midi/midiInput";

/** MIDI 接続の状態 */
export type MidiStatus =
  | "unsupported" // Web MIDI 非対応ブラウザ / 非セキュアコンテキスト
  | "idle" // 未接続(まだ許可を求めていない)
  | "granted" // 許可済み・デバイス一覧を取得できている
  | "denied" // 権限を拒否された
  | "error"; // その他のエラー

/** 一覧に出すデバイス情報(DOM 型に画面が依存しないよう最小限に落とす) */
export interface MidiDeviceInfo {
  id: string;
  name: string;
}

/** 「バーチャル鍵盤」を表す選択値(仕様書 F-01: 未接続時はバーチャル MIDI を選択可能) */
export const VIRTUAL_DEVICE_ID = "virtual";

/** MIDI のエラーを日本語メッセージに変換する(useHandCamera の toErrorMessage に倣う) */
function toMidiErrorMessage(e: unknown): { status: MidiStatus; message: string } {
  if (e instanceof DOMException) {
    if (e.name === "SecurityError" || e.name === "NotAllowedError") {
      return {
        status: "denied",
        message:
          "MIDI 機器の使用が許可されていません。ブラウザのアドレスバーのアイコンから許可して、再試行してください。",
      };
    }
    if (e.name === "NotSupportedError") {
      return {
        status: "unsupported",
        message: "このブラウザでは MIDI 機器を使えません。バーチャル鍵盤をお使いください。",
      };
    }
  }
  return { status: "error", message: `MIDI 機器への接続に失敗しました: ${String(e)}` };
}

export function useMidiDevices() {
  // 実 MIDI の入力源。インスタンスは 1 個だけ作り、内側のデバイスを差し替える
  const midiInputRef = useRef<MidiDeviceInput | null>(null);
  midiInputRef.current ??= new MidiDeviceInput();

  const accessRef = useRef<MIDIAccess | null>(null);

  const [status, setStatus] = useState<MidiStatus>(
    typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function"
      ? "idle"
      : "unsupported",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  // 既定はバーチャル鍵盤(これまでの動作を壊さない)
  const [selectedId, setSelectedId] = useState<string>(VIRTUAL_DEVICE_ID);
  // 選択中の実デバイスが今つながっているか(抜けたら false = 「切断中」表示)
  const [isSelectedConnected, setIsSelectedConnected] = useState(false);

  /**
   * 接続中のデバイス一覧を作る。
   * ※ MIDIInputMap は DOM の型定義上 forEach しか持たないため、values()/get() は使えない
   *   (実行時は動くが tsc で落ちる)。
   */
  const listInputs = useCallback((access: MIDIAccess): MidiDeviceInfo[] => {
    const list: MidiDeviceInfo[] = [];
    access.inputs.forEach((port) => {
      // 抜かれたポートが残ることがあるので、接続中のものだけ出す
      if (port.state !== "connected") return;
      list.push({ id: port.id, name: port.name ?? port.manufacturer ?? port.id });
    });
    return list;
  }, []);

  /** 指定 ID のポートを探す(get() が型定義に無いため forEach で探す) */
  const findInput = useCallback((access: MIDIAccess, id: string): MIDIInput | null => {
    let found: MIDIInput | null = null;
    access.inputs.forEach((port) => {
      if (port.id === id && port.state === "connected") found = port;
    });
    return found;
  }, []);

  /** 選択中のデバイスに接続し直す(抜き差し・選択変更のたびに呼ぶ) */
  const syncConnection = useCallback(
    (access: MIDIAccess, id: string) => {
      const input = midiInputRef.current!;
      if (id === VIRTUAL_DEVICE_ID) {
        input.disconnect();
        setIsSelectedConnected(false);
        return;
      }
      const port = findInput(access, id);
      if (port) {
        input.connect(port);
        setIsSelectedConnected(true);
      } else {
        // 抜かれている間は選択を保持したまま「切断中」にする(挿し直せば再接続される)
        input.disconnect();
        setIsSelectedConnected(false);
      }
    },
    [findInput],
  );

  /**
   * MIDI の使用許可を求める(仕様書 F-01: 権限リクエストの誘導)。
   * 唐突に権限プロンプトを出さないよう、必ずユーザー操作(ボタン)を起点に呼ぶ。
   */
  const requestAccess = useCallback(async () => {
    if (typeof navigator.requestMIDIAccess !== "function") {
      setStatus("unsupported");
      setErrorMessage(
        "このブラウザは Web MIDI に対応していません(Chrome または Edge をお使いください)。",
      );
      return;
    }
    try {
      // sysex(システムエクスクルーシブ)は使わないので false
      const access = await navigator.requestMIDIAccess({ sysex: false });
      accessRef.current = access;
      setStatus("granted");
      setErrorMessage("");
      setDevices(listInputs(access));

      // 抜き差しに追従する(選択は保持したまま、接続状態だけ更新)
      access.onstatechange = () => {
        setDevices(listInputs(access));
        setSelectedId((currentId) => {
          syncConnection(access, currentId);
          return currentId;
        });
      };
    } catch (e) {
      const { status: s, message } = toMidiErrorMessage(e);
      setStatus(s);
      setErrorMessage(message);
    }
  }, [listInputs, syncConnection]);

  /** デバイスを選択する(バーチャル鍵盤も選択肢のひとつ) */
  const selectDevice = useCallback(
    (id: string) => {
      setSelectedId(id);
      const access = accessRef.current;
      if (access) syncConnection(access, id);
    },
    [syncConnection],
  );

  // 画面離脱時に受信を止める
  useEffect(() => {
    const input = midiInputRef.current;
    return () => {
      input?.disconnect();
      if (accessRef.current) accessRef.current.onstatechange = null;
    };
  }, []);

  return {
    /** 実 MIDI の入力源(MidiSource)。バーチャル鍵盤と同じインターフェース */
    midiInput: midiInputRef.current,
    status,
    errorMessage,
    devices,
    selectedId,
    isSelectedConnected,
    selectDevice,
    requestAccess,
  };
}

export type UseMidiDevices = ReturnType<typeof useMidiDevices>;
