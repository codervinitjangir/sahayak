import React from "react";
import Svg, { Rect, Path } from "react-native-svg";

/** The Sahayak mark: a map pin with a cross cut out of it. Same artwork as web/public/favicon.svg. */
export default function LogoMark({
  size = 40,
  tile = true,
}: {
  size?: number;
  /** Draw the teal rounded tile behind the pin. Turn off on a teal background. */
  tile?: boolean;
}) {
  const pin = tile ? "#FFFFFF" : "#FFFFFF";
  const cut = "#111111";
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Sahayak">
      {tile && <Rect width={64} height={64} rx={16} fill="#111111" />}
      <Path
        fill={pin}
        d="M32 11c-9.1 0-16.5 7.1-16.5 15.9 0 11.8 16.5 27.1 16.5 27.1s16.5-15.3 16.5-27.1C48.5 18.1 41.1 11 32 11z"
      />
      <Rect x={25.5} y={24.5} width={13} height={5.5} rx={1.6} fill={cut} />
      <Rect x={29.25} y={20.75} width={5.5} height={13} rx={1.6} fill={cut} />
    </Svg>
  );
}
