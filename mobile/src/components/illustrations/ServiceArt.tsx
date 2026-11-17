// ─── Sahayak illustrations ───────────────────────────────────────────────────
// Hand-drawn flat SVG scenes, original to Sahayak. One per service plus a few
// for banners. viewBox 120×90 so they sit in tiles, banners and empty states.
import React from "react";
import Svg, { Circle, Rect, Path, G, Ellipse, Line } from "react-native-svg";

export type ArtName =
  | "tyre"
  | "battery"
  | "towing"
  | "mechanic"
  | "lockout"
  | "all"
  | "car"
  | "bike"
  | "partner"
  | "shield"
  | "wallet"
  | "map";

const INK = "#111827";
const SHADOW = "rgba(15,23,42,0.10)";

function Ground() {
  return <Ellipse cx={60} cy={82} rx={46} ry={5} fill={SHADOW} />;
}

function Tyre() {
  return (
    <G>
      <Ground />
      <Circle cx={52} cy={46} r={32} fill={INK} />
      <Circle cx={52} cy={46} r={26} fill="#374151" />
      {[0, 45, 90, 135].map((a) => (
        <Rect key={a} x={50} y={14} width={4} height={10} rx={2} fill="#4B5563" transform={`rotate(${a} 52 46)`} />
      ))}
      <Circle cx={52} cy={46} r={15} fill="#D1D5DB" />
      <Circle cx={52} cy={46} r={6} fill="#9CA3AF" />
      {/* nail + air puff */}
      <Path d="M80 30 l14 -8" stroke="#F59E0B" strokeWidth={4} strokeLinecap="round" />
      <Circle cx={98} cy={20} r={5} fill="#BAE6FD" />
      <Circle cx={106} cy={28} r={3.5} fill="#E0F2FE" />
      {/* wrench */}
      <Path d="M86 62 l18 14" stroke="#EF4444" strokeWidth={6} strokeLinecap="round" />
      <Circle cx={84} cy={60} r={7} fill="none" stroke="#EF4444" strokeWidth={5} />
    </G>
  );
}

function Battery() {
  return (
    <G>
      <Ground />
      <Rect x={22} y={30} width={62} height={46} rx={8} fill="#10B981" />
      <Rect x={22} y={30} width={62} height={12} rx={6} fill="#059669" />
      <Rect x={32} y={22} width={12} height={10} rx={2} fill="#374151" />
      <Rect x={62} y={22} width={12} height={10} rx={2} fill="#374151" />
      <Path d="M56 46 l-10 14 h9 l-4 12 l12 -16 h-9 l4 -10z" fill="#FDE68A" />
      {/* jumper cables */}
      <Path d="M38 22 C38 8, 98 4, 100 30" stroke="#EF4444" strokeWidth={3.5} fill="none" />
      <Path d="M68 22 C70 12, 106 14, 106 40" stroke={INK} strokeWidth={3.5} fill="none" />
      <Rect x={95} y={28} width={10} height={14} rx={3} fill="#EF4444" />
      <Rect x={102} y={38} width={9} height={13} rx={3} fill={INK} />
    </G>
  );
}

function Towing() {
  return (
    <G>
      <Ground />
      {/* truck */}
      <Rect x={8} y={44} width={58} height={22} rx={4} fill="#F59E0B" />
      <Path d="M66 66 V40 h16 l12 14 v12z" fill="#FBBF24" />
      <Path d="M70 44 h10 l8 10 h-18z" fill="#BAE6FD" />
      <Rect x={20} y={36} width={6} height={10} fill="#DC2626" />
      <Circle cx={23} cy={34} r={3} fill="#FCA5A5" />
      {/* boom */}
      <Line x1={14} y1={44} x2={2} y2={30} stroke="#4B5563" strokeWidth={4} strokeLinecap="round" />
      <Line x1={2} y1={30} x2={2} y2={48} stroke="#4B5563" strokeWidth={1.5} />
      <Circle cx={22} cy={68} r={8} fill={INK} />
      <Circle cx={22} cy={68} r={3} fill="#D1D5DB" />
      <Circle cx={80} cy={68} r={8} fill={INK} />
      <Circle cx={80} cy={68} r={3} fill="#D1D5DB" />
      {/* hazard sign */}
      <Path d="M104 46 l12 22 h-24z" fill="#FDE68A" stroke="#F59E0B" strokeWidth={2} />
      <Rect x={103} y={54} width={2} height={7} fill={INK} />
      <Circle cx={104} cy={64} r={1.3} fill={INK} />
    </G>
  );
}

function Mechanic() {
  return (
    <G>
      <Ground />
      {/* toolbox */}
      <Rect x={14} y={50} width={56} height={28} rx={5} fill="#2563EB" />
      <Rect x={14} y={50} width={56} height={9} rx={4} fill="#1D4ED8" />
      <Path d="M32 50 v-7 h20 v7" stroke="#1E3A8A" strokeWidth={4} fill="none" />
      <Rect x={38} y={60} width={8} height={5} rx={1.5} fill="#BFDBFE" />
      {/* crossed tools */}
      <Path d="M70 14 l30 40" stroke="#6B7280" strokeWidth={6} strokeLinecap="round" />
      <Circle cx={68} cy={12} r={8} fill="none" stroke="#6B7280" strokeWidth={5} />
      <Path d="M104 16 l-30 40" stroke="#F97316" strokeWidth={6} strokeLinecap="round" />
      <Rect x={98} y={8} width={14} height={9} rx={2} fill="#4B5563" transform="rotate(-53 105 12)" />
      {/* gear */}
      <Circle cx={96} cy={70} r={10} fill="#10B981" />
      <Circle cx={96} cy={70} r={4} fill="#ECFDF5" />
    </G>
  );
}

function Lockout() {
  return (
    <G>
      <Ground />
      {/* car door */}
      <Path d="M14 76 V36 q0 -10 10 -14 l26 -8 h22 v62z" fill="#8B5CF6" />
      <Path d="M24 40 q0 -8 8 -11 l18 -6 h16 v17z" fill="#DDD6FE" />
      <Rect x={52} y={48} width={14} height={4} rx={2} fill="#4C1D95" />
      {/* key */}
      <Circle cx={92} cy={34} r={14} fill="none" stroke="#F59E0B" strokeWidth={6} />
      <Path d="M86 46 L74 72" stroke="#F59E0B" strokeWidth={6} strokeLinecap="round" />
      <Path d="M78 62 l7 3 M75 68 l7 3" stroke="#F59E0B" strokeWidth={4} strokeLinecap="round" />
      <Circle cx={92} cy={34} r={4} fill="#FEF3C7" />
    </G>
  );
}

function All() {
  return (
    <G>
      {[0, 1].map((r) =>
        [0, 1].map((c) => (
          <Rect key={`${r}${c}`} x={30 + c * 32} y={14 + r * 32} width={26} height={26} rx={8} fill={INK} />
        ))
      )}
    </G>
  );
}

function Car() {
  return (
    <G>
      <Ground />
      <Path d="M10 66 v-14 q0 -6 6 -8 l14 -4 l14 -14 q4 -4 10 -4 h26 q6 0 10 4 l12 14 l6 2 q6 2 6 8 v16z" fill="#2563EB" />
      <Path d="M36 40 l12 -12 h12 v12z M64 28 h14 l10 12 h-24z" fill="#DBEAFE" />
      <Rect x={98} y={50} width={8} height={5} rx={2} fill="#FDE68A" />
      <Circle cx={34} cy={68} r={10} fill={INK} />
      <Circle cx={34} cy={68} r={4} fill="#D1D5DB" />
      <Circle cx={88} cy={68} r={10} fill={INK} />
      <Circle cx={88} cy={68} r={4} fill="#D1D5DB" />
    </G>
  );
}

function Bike() {
  return (
    <G>
      <Ground />
      <Circle cx={28} cy={62} r={16} fill="none" stroke={INK} strokeWidth={6} />
      <Circle cx={92} cy={62} r={16} fill="none" stroke={INK} strokeWidth={6} />
      <Path d="M28 62 l22 -22 h26 l16 22" stroke="#4B5563" strokeWidth={4} fill="none" />
      <Path d="M44 42 q8 -14 30 -12 l8 12 h-38z" fill="#EF4444" />
      <Rect x={50} y={28} width={22} height={6} rx={3} fill={INK} />
      <Path d="M84 30 l8 -8 h8" stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" />
      <Circle cx={100} cy={34} r={4} fill="#FDE68A" />
    </G>
  );
}

function Partner() {
  return (
    <G>
      <Ground />
      <Circle cx={60} cy={26} r={14} fill="#FCD34D" />
      <Path d="M46 22 q14 -14 28 0 v-4 q-14 -10 -28 0z" fill={INK} />
      <Path d="M32 80 q0 -32 28 -32 q28 0 28 32z" fill="#10B981" />
      <Path d="M54 50 l6 10 l6 -10" fill="#ECFDF5" />
      <Path d="M88 54 l18 -18" stroke="#6B7280" strokeWidth={6} strokeLinecap="round" />
      <Circle cx={108} cy={34} r={6} fill="none" stroke="#6B7280" strokeWidth={4} />
      <Circle cx={22} cy={40} r={9} fill="#2563EB" />
      <Path d="M18 40 l3 3 l6 -6" stroke="#fff" strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </G>
  );
}

function Shield() {
  return (
    <G>
      <Ground />
      <Path d="M60 8 l34 12 v22 q0 26 -34 38 q-34 -12 -34 -38 v-22z" fill="#10B981" />
      <Path d="M60 16 l26 9 v17 q0 20 -26 30z" fill="#059669" />
      <Path d="M44 44 l11 11 l22 -22" stroke="#fff" strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </G>
  );
}

function Wallet() {
  return (
    <G>
      <Ground />
      <Rect x={18} y={26} width={76} height={52} rx={10} fill="#10B981" />
      <Rect x={18} y={26} width={76} height={14} rx={7} fill="#059669" />
      <Rect x={70} y={46} width={30} height={18} rx={6} fill="#047857" />
      <Circle cx={80} cy={55} r={4} fill="#FDE68A" />
      <Circle cx={36} cy={16} r={10} fill="#FBBF24" />
      <Circle cx={54} cy={12} r={8} fill="#FCD34D" />
      <Path d="M33 12 h6 M33 16 h6 M36 12 q5 0 0 8" stroke="#92400E" strokeWidth={1.8} fill="none" />
    </G>
  );
}

function MapArt() {
  return (
    <G>
      <Ground />
      <Path d="M14 22 l28 -8 l36 8 l28 -8 v56 l-28 8 l-36 -8 l-28 8z" fill="#E0F2FE" />
      <Path d="M42 14 v56 M78 22 v56" stroke="#BAE6FD" strokeWidth={2} />
      <Path d="M20 60 q20 -30 40 -10 t40 -20" stroke="#2563EB" strokeWidth={3} fill="none" strokeDasharray="5 4" />
      <Path d="M92 18 q-10 0 -10 10 q0 8 10 18 q10 -10 10 -18 q0 -10 -10 -10z" fill="#EF4444" />
      <Circle cx={92} cy={28} r={4} fill="#fff" />
    </G>
  );
}

const MAP: Record<ArtName, () => React.ReactElement> = {
  tyre: Tyre,
  battery: Battery,
  towing: Towing,
  mechanic: Mechanic,
  lockout: Lockout,
  all: All,
  car: Car,
  bike: Bike,
  partner: Partner,
  shield: Shield,
  wallet: Wallet,
  map: MapArt,
};

export default function ServiceArt({ name, width = 96, height }: { name: ArtName; width?: number; height?: number }) {
  const Comp = MAP[name] ?? All;
  return (
    <Svg width={width} height={height ?? (width * 90) / 120} viewBox="0 0 120 90" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Comp />
    </Svg>
  );
}

/** Which illustration fits a service code or group. */
export function artForService(codeOrGroup: string | undefined | null): ArtName {
  const c = (codeOrGroup ?? "").toLowerCase();
  if (c.includes("tow") || c.includes("flatbed")) return "towing";
  if (c.includes("battery") || c.includes("jump")) return "battery";
  if (c.includes("tyre") || c.includes("tire") || c.includes("puncture")) return "tyre";
  if (c.includes("lock") || c.includes("key")) return "lockout";
  return "mechanic";
}
