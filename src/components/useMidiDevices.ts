// MIDI デバイスの検出・選択・接続管理(仕様書 F-01 / 3.1)
//
// このフックは App.tsx で 1 回だけ呼び、props で各画面へ配る。
// (タブ切替やキャリブレーション完了で画面が再マウントされても選択が消えないようにするため)

import { useCallback, useEffect, useRef, useState } from "react";
import { MidiDeviceInput } from "../midi/midiInput";
import {
  buildDeviceList,
  isPortUsable,
  type MidiDeviceInfo,
  type PortSnapshot,
} from "./midiPortList";

export type { MidiDeviceInfo } from "./midiPortList";

/** MIDI 接続の状態 */
export type MidiStatus =
  | "unsupported" // Web MIDI 非対応ブラウザ / 非セキュアコンテキスト
  | "idle" // 未接続(まだ許可を求めていない)
  | "granted" // 許可済み・デバイス一覧を取得できている
  | "denied" // 権限を拒否された
  | "error"; // その他のエラー

/**
 * 接続の詳細(うまくつながらないときの原因調べ用)。
 * ブラウザが MIDI 機器をどう報告しているかを、そのまま画面に出す。
 */
export interface MidiDiagnostics {
  /** 入力ポート(キーボード → アプリ)。キーボードはここに出るはず */
  inputs: PortSnapshot[];
  /** 出力ポート(アプリ → 機器)。参考用 */
  outputs: PortSnapshot[];
  /** 抜き差しなどの通知を受け取った回数 */
  stateChangeCount: number;
  /** 最後に一覧を調べた時刻(ミリ秒) */
  lastScanAt: number | null;
}

/** 「バーチャル鍵盤」を表す選択値(仕様書 F-01: 未接続時はバーチャル MIDI を選択可能) */
export const VIRTUAL_DEVICE_ID = "virtual";

/**
 * 許可を得たあと、一覧を調べ直すタイミング(**単位: ミリ秒**)。
 * Android では、許可が出た瞬間にはまだ機器の認識が終わっていないことがあるため、
 * すぐ・少し後・もう少し後の 3 回調べる。
 */
const RESCAN_DELAYS_MS = [0, 500, 2000];

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

/**
 * ブラウザのポート一覧を、ただの配列に写し取る。
 * ※ MIDIInputMap / MIDIOutputMap は DOM の型定義上 forEach しか持たないため、
 *   values()/get() は使えない(実行時は動くが tsc で落ちる)。
 */
function snapshotPorts(map: MIDIInputMap | MIDIOutputMap): PortSnapshot[] {
  const list: PortSnapshot[] = [];
  map.forEach((port: MIDIPort) => {
    list.push({
      id: port.id,
      name: port.name,
      manufacturer: port.manufacturer,
      state: String(port.state),
      connection: String(port.connection),
    });
  });
  return list;
}

export function useMidiDevices() {
  // 実 MIDI の入力源。インスタンスは 1 個だけ作り、内側のデバイスを差し替える
  const midiInputRef = useRef<MidiDeviceInput | null>(null);
  midiInputRef.current ??= new MidiDeviceInput();

  const accessRef = useRef<MIDIAccess | null>(null);
  const rescanTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [status, setStatus] = useState<MidiStatus>(
    typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function"
      ? "idle"
      : "unsupported",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  // 既定はバーチャル鍵盤(これまでの動作を壊さない)
  const [selectedId, setSelectedId] = useState<string>(VIRTUAL_DEVICE_ID);
  // 抜き差しの通知から最新の選択を参照するための ref
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  // 選択中の実デバイスが今つながっているか(抜けたら false = 「切断中」表示)
  const [isSelectedConnected, setIsSelectedConnected] = useState(false);
  const [diagnostics, setDiagnostics] = useState<MidiDiagnostics>({
    inputs: [],
    outputs: [],
    stateChangeCount: 0,
    lastScanAt: null,
  });

  /** 指定 ID のポートを探す(get() が型定義に無いため forEach で探す) */
  const findInput = useCallback((access: MIDIAccess, id: string): MIDIInput | null => {
    let found: MIDIInput | null = null;
    access.inputs.forEach((port) => {
      if (port.id === id && isPortUsable(String(port.state))) found = port;
    });
    return found;
  }, []);

  /** 選択中のデバイスに接続し直す(抜き差し・選択変更・探し直しのたびに呼ぶ) */
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
        // すでに同じ機器につながっていれば、つなぎ直さない(受信を途切れさせないため)
        if (input.getConnectedId() !== port.id) input.connect(port);
        setIsSelectedConnected(true);
      } else {
        // 抜かれている間は選択を保持したまま「切断中」にする(挿し直せば再接続される)
        input.disconnect();
        setIsSelectedConnected(false);
      }
    },
    [findInput],
  );

  /** 一覧と接続の詳細を調べ直す */
  const scan = useCallback(
    (access: MIDIAccess) => {
      const inputs = snapshotPorts(access.inputs);
      setDevices(buildDeviceList(inputs));
      setDiagnostics((prev) => ({
        ...prev,
        inputs,
        outputs: snapshotPorts(access.outputs),
        lastScanAt: Date.now(),
      }));
      syncConnection(access, selectedIdRef.current);
    },
    [syncConnection],
  );

  const clearRescanTimers = () => {
    rescanTimersRef.current.forEach((t) => clearTimeout(t));
    rescanTimersRef.current = [];
  };

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

      // 抜き差しに追従する(選択は保持したまま、接続状態だけ更新)
      access.onstatechange = () => {
        setDiagnostics((prev) => ({ ...prev, stateChangeCount: prev.stateChangeCount + 1 }));
        scan(access);
      };

      // 認識の遅れに備えて、何回かに分けて調べる
      clearRescanTimers();
      rescanTimersRef.current = RESCAN_DELAYS_MS.map((delay) =>
        setTimeout(() => scan(access), delay),
      );
    } catch (e) {
      const { status: s, message } = toMidiErrorMessage(e);
      setStatus(s);
      setErrorMessage(message);
    }
  }, [scan]);

  /** 「再検索」ボタン: 許可済みなら一覧を調べ直し、まだなら許可を求める */
  const rescan = useCallback(() => {
    const access = accessRef.current;
    if (access) {
      scan(access);
    } else {
      void requestAccess();
    }
  }, [scan, requestAccess]);

  /** デバイスを選択する(バーチャル鍵盤も選択肢のひとつ) */
  const selectDevice = useCallback(
    (id: string) => {
      setSelectedId(id);
      selectedIdRef.current = id;
      const access = accessRef.current;
      if (access) syncConnection(access, id);
    },
    [syncConnection],
  );

  // 画面離脱時に受信を止める
  useEffect(() => {
    const input = midiInputRef.current;
    return () => {
      clearRescanTimers();
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
    diagnostics,
    selectDevice,
    requestAccess,
    rescan,
  };
}

export type UseMidiDevices = ReturnType<typeof useMidiDevices>;
