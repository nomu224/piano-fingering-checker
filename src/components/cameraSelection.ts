// 起動時に使うカメラの選び方(仕様書 F-01 のカメラ選択を補助する)
//
// ブラウザの既定カメラが「仮想カメラ」(スマホ連携アプリや配信ソフトが作るもの)になっていると、
// アプリを開いたときに何も映らないことがある。
// このアプリは実際の手を撮る必要があるため、**実カメラがあればそちらを優先**する。
// (ユーザーは引き続きカメラ選択欄で自由に切り替えられる)
//
// 判定はデバイス名によるヒューリスティックなので、迷ったら「既定のまま」に倒す。

/** 仮想カメラらしいデバイス名のパターン */
const VIRTUAL_CAMERA_PATTERN =
  /ivcam|droidcam|epoccam|iriun|obs|virtual|manycam|xsplit|snap\s*camera|camo|ndi/i;

/** デバイス名から仮想カメラかどうかを推定する */
export function isVirtualCamera(label: string): boolean {
  return VIRTUAL_CAMERA_PATTERN.test(label);
}

/** カメラ選択に必要な最小限の情報(MediaDeviceInfo の一部) */
export interface CameraChoice {
  deviceId: string;
  label: string;
}

/**
 * 起動時に使うべきカメラを選ぶ。
 *
 * - 今のカメラが仮想カメラで、実カメラが他にあれば、その実カメラの ID を返す
 * - それ以外(実カメラを使っている / 実カメラが無い / 判断できない)は null を返し、既定のまま使う
 *
 * @param devices 検出されたカメラ一覧
 * @param activeDeviceId 現在使われているカメラの ID
 */
export function pickRealCamera(
  devices: readonly CameraChoice[],
  activeDeviceId: string | undefined,
): string | null {
  if (!activeDeviceId) return null;

  const active = devices.find((d) => d.deviceId === activeDeviceId);
  // 名前が取れない(権限前など)場合は判断できないので既定のまま
  if (!active || active.label === "") return null;
  if (!isVirtualCamera(active.label)) return null;

  const real = devices.find(
    (d) => d.deviceId !== activeDeviceId && d.label !== "" && !isVirtualCamera(d.label),
  );
  return real ? real.deviceId : null;
}
