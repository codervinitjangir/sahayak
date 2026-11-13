import {
  Truck,
  BatteryCharging,
  CircleDot,
  Wrench,
  Fuel,
  KeyRound,
  LifeBuoy,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icon for a catalogue service. Matches on substrings so a new catalogue code
 * ("flatbed_towing", "wheel_lift_towing", ...) still gets a sensible glyph; anything
 * unrecognised falls back to a neutral lifebuoy rather than a question mark.
 */
export function serviceIcon(code: string): LucideIcon {
  const c = code.toLowerCase();
  if (c.includes('tow')) return Truck;
  if (c.includes('batter') || c.includes('jump')) return BatteryCharging;
  if (c.includes('tyre') || c.includes('tire') || c.includes('puncture')) return CircleDot;
  if (c.includes('fuel')) return Fuel;
  if (c.includes('lock') || c.includes('key')) return KeyRound;
  if (c.includes('repair') || c.includes('mechanic')) return Wrench;
  return LifeBuoy;
}
