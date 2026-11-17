import React from "react";
import Svg, { Rect, Path, Circle, Defs, LinearGradient, Stop } from "react-native-svg";

/**
 * The Sahayak mark: a map pin (where you are) holding a wrench (help arrives)
 * on a green road. Same artwork as assets/brand/sahayak-mark.svg and the app icon.
 */
export default function LogoMark({
  size = 40,
  tile = true,
}: {
  size?: number;
  /** Draw the dark rounded tile behind the pin. Turn off on a dark background. */
  tile?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Sahayak">
      <Defs>
        <LinearGradient id="lmTile" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#1F2937" />
          <Stop offset="1" stopColor="#050505" />
        </LinearGradient>
        <LinearGradient id="lmGo" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#4ADE80" />
          <Stop offset="1" stopColor="#16A34A" />
        </LinearGradient>
      </Defs>
      {tile && <Rect width={64} height={64} rx={15} fill="url(#lmTile)" />}
      <Path d="M10 50 C22 41, 42 41, 54 50" stroke="url(#lmGo)" strokeWidth={4.5} fill="none" strokeLinecap="round" />
      <Path d="M32 8c-9.4 0-17 7.3-17 16.4C15 36.6 32 50 32 50s17-13.4 17-25.6C49 15.3 41.4 8 32 8z" fill="#FFFFFF" />
      <Circle cx={32} cy={24.5} r={10} fill="url(#lmGo)" />
      <Path d="M36.6 18.6a5 5 0 0 0-5.9 6.2l-6 6a1.7 1.7 0 0 0 2.4 2.4l6-6a5 5 0 0 0 6.2-5.9l-2.9 2.9-2.5-.6-.6-2.5z" fill="#FFFFFF" />
    </Svg>
  );
}
