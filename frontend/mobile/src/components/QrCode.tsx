import { forwardRef, useMemo } from "react";
import Svg, { Path, Rect } from "react-native-svg";

import { qrMatrixPath } from "../features/gymOwner/checkinQr";

/**
 * A QR code as one SVG path on a white card with the standard 4-module quiet zone. Always black on
 * white regardless of theme — scanners need the contrast, and the printed copy must match. The ref
 * is the underlying <Svg>, so callers can `toDataURL` it to save/print a PNG.
 */
export const QrCode = forwardRef<Svg, { value: string; size: number }>(function QrCode({ value, size }, ref) {
  const { size: modules, path } = useMemo(() => qrMatrixPath(value), [value]);
  const quiet = 4;
  const box = modules + quiet * 2;
  return (
    <Svg ref={ref} width={size} height={size} viewBox={`${-quiet} ${-quiet} ${box} ${box}`}>
      <Rect x={-quiet} y={-quiet} width={box} height={box} fill="#ffffff" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
});
