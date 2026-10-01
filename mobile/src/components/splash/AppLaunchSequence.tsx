// ─── AppLaunchSequence.tsx ───────────────────────────────────────────────────
// High-fidelity opening sequence for Sahayak launch motion.
// Reproduces exact reference trajectory from video measurements & spreadsheet:
// 1. Initial 450ms still hold (wordmark "Sahayak" & tagline clearly visible)
// 2. Keyframed Catmull-Rom spline trajectory (0.45 - 1.12s, t_rel = 0.00 - 0.67s)
// 3. Counter-clockwise spin (45° -> -180° upright, peaking at 550°/s)
// 4. Dynamic left-to-right text erase edge (0.45 - 0.65s, t_rel = 0.00 - 0.20s)
// 5. Center hold (1.12 - 1.29s) -> shrink anticipation (1.29 - 1.38s)
// 6. Snappy pop (1.38 - 1.42s) -> half screen (1.45 - 1.48s)
// 7. Accelerated star reveal window (1.52 - 1.68s) -> instant Login screen.
// 100% UI thread execution via React Native Reanimated.

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Platform,
  AccessibilityInfo,
  TouchableOpacity,
} from "react-native";
import Svg, {
  Defs,
  Mask,
  Rect,
  Path,
  G,
  Circle,
  Line,
  Text as SvgText,
} from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  Easing,
  runOnJS,
  cancelAnimation,
} from "react-native-reanimated";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { splashConfig, STAR_KEYFRAMES, Keyframe } from "../../config/splashConfig";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const AnimatedG = Animated.createAnimatedComponent(G);

// Center coordinate landmarks
const RESTING_CENTER_X = SCREEN_WIDTH * 0.497;
const RESTING_CENTER_Y = SCREEN_HEIGHT * 0.493;

// Corner distance for full SVG mask clearance
const CORNER_DIST = Math.sqrt(
  Math.pow(SCREEN_WIDTH / 2, 2) + Math.pow(SCREEN_HEIGHT / 2, 2)
);
const MAX_REVEAL_SCALE = (CORNER_DIST / splashConfig.symbol.waistRadius) * 1.18;

// ─── 1. CATMULL-ROM SPLINE EVALUATOR (100% UI THREAD WORKLET) ─────────────────
function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  u: number
): number {
  "worklet";
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * (u * u) +
      (-p0 + 3 * p1 - 3 * p2 + p3) * (u * u * u))
  );
}

export function evaluateStarSpline(tRel: number): {
  x: number;
  y: number;
  size: number;
} {
  "worklet";
  if (tRel <= 0.0) {
    return {
      x: STAR_KEYFRAMES[0].x,
      y: STAR_KEYFRAMES[0].y,
      size: STAR_KEYFRAMES[0].size,
    };
  }
  if (tRel >= 0.84) {
    return {
      x: STAR_KEYFRAMES[STAR_KEYFRAMES.length - 1].x,
      y: STAR_KEYFRAMES[STAR_KEYFRAMES.length - 1].y,
      size: STAR_KEYFRAMES[STAR_KEYFRAMES.length - 1].size,
    };
  }

  const len = STAR_KEYFRAMES.length;
  for (let i = 0; i < len - 1; i++) {
    const k0 = STAR_KEYFRAMES[i];
    const k1 = STAR_KEYFRAMES[i + 1];
    if (tRel >= k0.t && tRel <= k1.t) {
      const u = k1.t > k0.t ? (tRel - k0.t) / (k1.t - k0.t) : 0;
      const km1 =
        i > 0
          ? STAR_KEYFRAMES[i - 1]
          : {
              t: 0,
              x: 2 * k0.x - k1.x,
              y: 2 * k0.y - k1.y,
              size: 2 * k0.size - k1.size,
            };
      const kp2 =
        i + 2 < len
          ? STAR_KEYFRAMES[i + 2]
          : {
              t: 0,
              x: 2 * k1.x - k0.x,
              y: 2 * k1.y - k0.y,
              size: 2 * k1.size - k0.size,
            };

      const x = catmullRom(km1.x, k0.x, k1.x, kp2.x, u);
      const y = catmullRom(km1.y, k0.y, k1.y, kp2.y, u);
      const size = catmullRom(km1.size, k0.size, k1.size, kp2.size, u);
      return { x, y, size };
    }
  }
  return { x: 0.497, y: 0.493, size: 0.052 };
}

// ─── 2. ROTATION CURVE EVALUATOR (45° -> -180° UPRIGHT, PEAK 550°/s) ───────────
const ROT_KEYFRAMES = [
  { t: 0.0, r: 45.0 },
  { t: 0.07, r: 35.0 },
  { t: 0.13, r: 15.0 },
  { t: 0.2, r: -15.0 },
  { t: 0.33, r: -85.0 }, // ~538 deg/s between 0.20 and 0.33s
  { t: 0.5, r: -145.0 },
  { t: 0.6, r: -172.0 },
  { t: 0.67, r: -180.0 }, // Finishes upright
  { t: 0.84, r: -180.0 },
];

export function evaluateRotation(tRel: number): number {
  "worklet";
  if (tRel <= 0.0) return 45.0;
  if (tRel >= 0.67) return -180.0;

  for (let i = 0; i < ROT_KEYFRAMES.length - 1; i++) {
    const k0 = ROT_KEYFRAMES[i];
    const k1 = ROT_KEYFRAMES[i + 1];
    if (tRel >= k0.t && tRel <= k1.t) {
      const u = (tRel - k0.t) / (k1.t - k0.t);
      const s = u * u * (3 - 2 * u);
      return k0.r + (k1.r - k0.r) * s;
    }
  }
  return -180.0;
}

// Pre-calculate reference dotted path for debug view
const generateDottedSplinePath = (): string => {
  let pathStr = "";
  for (let step = 0; step <= 84; step++) {
    const t = step / 100.0;
    const pt = evaluateStarSpline(t);
    const px = pt.x * SCREEN_WIDTH;
    const py = pt.y * SCREEN_HEIGHT;
    if (step === 0) {
      pathStr += `M ${px.toFixed(1)} ${py.toFixed(1)}`;
    } else {
      pathStr += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
    }
  }
  return pathStr;
};

export interface AppLaunchSequenceProps {
  onAnimationComplete?: () => void;
  isReady?: boolean;
  debug?: boolean;
}

export default function AppLaunchSequence({
  onAnimationComplete,
  isReady = true,
  debug = false,
}: AppLaunchSequenceProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [statusBarStyle, setStatusBarStyle] = useState<"light" | "dark">("light");
  const [debugTime, setDebugTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(!debug);
  const [showDebugOverlay, setShowDebugOverlay] = useState(debug);

  const timeline = useSharedValue(0.0);
  const readyGate = useSharedValue(isReady ? 1 : 0);

  useEffect(() => {
    readyGate.value = isReady ? 1 : 0;
  }, [isReady]);

  // Hide native splash screen seamlessly once this identical JS layer mounts
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // System reduce motion check
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => sub?.remove();
  }, []);

  const handleSequenceFinish = () => {
    if (!showDebugOverlay) {
      setIsCompleted(true);
      onAnimationComplete?.();
    }
  };

  const updateStatusBarStyle = (style: "light" | "dark") => {
    setStatusBarStyle(style);
  };

  const startSequence = (fromTime = 0) => {
    cancelAnimation(timeline);
    timeline.value = fromTime;

    if (reduceMotion) {
      timeline.value = withTiming(
        splashConfig.timings.TOTAL_DURATION,
        { duration: 250, easing: Easing.linear },
        (fin) => {
          if (fin) runOnJS(handleSequenceFinish)();
        }
      );
      return;
    }

    const remainingDuration =
      (splashConfig.timings.TOTAL_DURATION - fromTime) * 1000;

    timeline.value = withTiming(
      splashConfig.timings.TOTAL_DURATION,
      {
        duration: Math.max(10, remainingDuration),
        easing: Easing.linear,
      },
      (finished) => {
        if (finished) {
          runOnJS(handleSequenceFinish)();
        }
      }
    );
  };

  useEffect(() => {
    if (!showDebugOverlay) {
      startSequence(0);
    }
    return () => cancelAnimation(timeline);
  }, [reduceMotion, showDebugOverlay]);

  // ─── 1. SOLID GREEN OVERLAY (FULL-SCREEN BRAND COLOR LAYER) ────────────────
  const animatedOverlayStyle = useAnimatedStyle(() => {
    const t = timeline.value;
    if (reduceMotion) {
      const p = t / splashConfig.timings.TOTAL_DURATION;
      return { opacity: 1 - p };
    }

    let opacity = 1.0;
    if (
      t >= splashConfig.timings.T8_HALF_SCREEN &&
      t < splashConfig.timings.T9_REVEAL_START
    ) {
      // drops to about half opacity
      opacity = 0.52;
    } else if (
      t >= splashConfig.timings.T9_REVEAL_START &&
      t < splashConfig.timings.T11_COMPLETE
    ) {
      const p =
        (t - splashConfig.timings.T9_REVEAL_START) /
        (splashConfig.timings.T11_COMPLETE -
          splashConfig.timings.T9_REVEAL_START);
      opacity = 0.52 * (1 - p);
    } else if (t >= splashConfig.timings.T11_COMPLETE) {
      opacity = 0;
    }
    return { opacity };
  });

  // ─── 2. LOGO CONTAINER FADE & VERTICAL ERASE CURTAINS ───────────────────────
  const animatedLogoContainerStyle = useAnimatedStyle(() => {
    const t = timeline.value;
    if (t >= splashConfig.timings.T2_ALL_ERASED) {
      return { opacity: 0 };
    }
    return { opacity: 1 };
  });

  // Vertical erase edge follows star's x position from left to right (0.45 - 0.65s)
  const animatedWordmarkCurtainStyle = useAnimatedStyle(() => {
    const t = timeline.value;
    // During initial 450ms hold: wordmark is 100% visible, curtain width is 0%
    if (t <= splashConfig.timings.T0_MOTION_START) {
      return { width: "0%" };
    }
    if (t >= splashConfig.timings.T1_WORDMARK_ERASED) {
      return { width: "100%" };
    }
    // As star travels across wordmark (from 0.45 to 0.58s = 130ms), curtain wipes across
    const p =
      (t - splashConfig.timings.T0_MOTION_START) /
      (splashConfig.timings.T1_WORDMARK_ERASED -
        splashConfig.timings.T0_MOTION_START);
    return { width: `${Math.min(100, Math.max(0, p * 105))}%` };
  });

  const animatedTaglineCurtainStyle = useAnimatedStyle(() => {
    const t = timeline.value;
    if (t <= splashConfig.timings.T0_MOTION_START) {
      return { width: "0%" };
    }
    if (t >= splashConfig.timings.T2_ALL_ERASED) {
      return { width: "100%" };
    }
    const p =
      (t - splashConfig.timings.T0_MOTION_START) /
      (splashConfig.timings.T2_ALL_ERASED -
        splashConfig.timings.T0_MOTION_START);
    return { width: `${Math.min(100, Math.max(0, p * 100))}%` };
  });

  // ─── 3. STAR OBJECT (TRAJECTORY, SIZE, ROTATION, GATHER & POP) ─────────────
  const animatedStarStyle = useAnimatedStyle(() => {
    const t = timeline.value;

    if (t > splashConfig.timings.T8_HALF_SCREEN) {
      // Handoff to SVG window mask reveal
      return { opacity: 0 };
    }

    let x = 0.277;
    let y = 0.490;
    let sw = 0.084;
    let sh = 0.084;
    let rot = 45.0;
    let opacity = 1.0;

    // Phase 0: 0.00 - 0.45s: Brand still hold (Star sits at logo left, tilted 45°)
    if (t <= splashConfig.timings.T0_MOTION_START) {
      x = 0.277;
      y = 0.490;
      sw = 0.084;
      sh = 0.084;
      rot = 45.0;
    } else {
      // Relative motion time (0.00s when star leaves logo)
      const tRel = t - splashConfig.timings.T0_MOTION_START;

      if (tRel <= 0.67) {
        // Catmull-Rom spline trajectory
        const pt = evaluateStarSpline(tRel);
        x = pt.x;
        y = pt.y;
        sw = pt.size;
        sh = pt.size;
        rot = evaluateRotation(tRel);
      } else if (tRel <= 0.84) {
        // Still center hold (5.2% width, upright at -180°)
        x = 0.497;
        y = 0.493;
        sw = 0.052;
        sh = 0.052;
        rot = -180.0;
      } else if (tRel <= 0.93) {
        // Anticipation shrink from 5.2% to 2.0%
        const p = (tRel - 0.84) / 0.09;
        x = 0.497;
        y = 0.493;
        sw = 0.052 - (0.052 - 0.02) * p;
        sh = sw;
        rot = -180.0;
      } else if (tRel <= 0.97) {
        // Pops open to 20% width x 23% height
        const p = (tRel - 0.93) / 0.04;
        const easedP = Math.sin((p * Math.PI) / 2);
        x = 0.497;
        y = 0.493;
        sw = 0.02 + (0.2 - 0.02) * easedP;
        sh = 0.02 + (0.23 - 0.02) * easedP;
        rot = -180.0;
      } else if (tRel <= 1.0) {
        // Hold for 0.03s
        x = 0.497;
        y = 0.493;
        sw = 0.2;
        sh = 0.23;
        rot = -180.0;
      } else if (tRel <= 1.03) {
        // Grows to 51% width x 58% height
        const p = (tRel - 1.0) / 0.03;
        x = 0.497;
        y = 0.493;
        sw = 0.2 + (0.51 - 0.2) * p;
        sh = 0.23 + (0.58 - 0.23) * p;
        rot = -180.0;
      }
    }

    const starPixelWidth = sw * SCREEN_WIDTH;
    const starPixelHeight = sh * SCREEN_WIDTH;
    const posX = x * SCREEN_WIDTH - starPixelWidth / 2;
    const posY = y * SCREEN_HEIGHT - starPixelHeight / 2;

    return {
      opacity,
      width: starPixelWidth,
      height: starPixelHeight,
      transform: [
        { translateX: posX },
        { translateY: posY },
        { rotate: `${rot}deg` },
      ],
    };
  });

  // ─── 4. SVG MASK HOLE (ACCELERATED STAR REVEAL) ───────────────────────────
  const animatedHoleProps = useAnimatedProps(() => {
    const t = timeline.value;

    if (
      t >= splashConfig.timings.T10_CORNERS_ONLY &&
      statusBarStyle !== "dark"
    ) {
      runOnJS(updateStatusBarStyle)("dark");
    } else if (
      t < splashConfig.timings.T10_CORNERS_ONLY &&
      statusBarStyle !== "light"
    ) {
      runOnJS(updateStatusBarStyle)("light");
    }

    if (t < splashConfig.timings.T8_HALF_SCREEN) {
      return {
        transform: [
          { translateX: RESTING_CENTER_X },
          { translateY: RESTING_CENTER_Y },
          { scale: 0 },
          { translateX: -50 },
          { translateY: -50 },
        ],
      };
    }

    if (t < splashConfig.timings.T9_REVEAL_START) {
      const startScale = (SCREEN_WIDTH * 0.51) / 100;
      return {
        transform: [
          { translateX: RESTING_CENTER_X },
          { translateY: RESTING_CENTER_Y },
          { scale: startScale },
          { translateX: -50 },
          { translateY: -50 },
        ],
      };
    }

    // Scales up with acceleration until larger than screen
    const p =
      (t - splashConfig.timings.T9_REVEAL_START) /
      (splashConfig.timings.T11_COMPLETE -
        splashConfig.timings.T9_REVEAL_START);
    const accelP = Math.pow(p, 2.7);

    const startScale = (SCREEN_WIDTH * 0.51) / 100;
    const currentScale =
      startScale + (MAX_REVEAL_SCALE - startScale) * accelP;

    return {
      transform: [
        { translateX: RESTING_CENTER_X },
        { translateY: RESTING_CENTER_Y },
        { scale: currentScale },
        { translateX: -50 },
        { translateY: -50 },
      ],
    };
  });

  if (isCompleted && !showDebugOverlay) {
    return null;
  }

  const handleScrub = (time: number) => {
    cancelAnimation(timeline);
    timeline.value = time;
    setDebugTime(time);
    setIsPlaying(false);
  };

  const tRelCurrent = Math.max(0, debugTime - splashConfig.timings.T0_MOTION_START);
  const currentPt = evaluateStarSpline(tRelCurrent);
  const currentRot = evaluateRotation(tRelCurrent);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={showDebugOverlay ? "box-none" : "auto"}
    >
      <StatusBar style={statusBarStyle} />

      {/* ── LAYER 1: SVG MASKED BRAND COLOR REVEAL WINDOW ── */}
      <Animated.View
        style={[StyleSheet.absoluteFill, animatedOverlayStyle]}
        pointerEvents="none"
      >
        <Svg
          width={SCREEN_WIDTH}
          height={SCREEN_HEIGHT}
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            <Mask id="starRevealWindowMask">
              <Rect
                x="0"
                y="0"
                width={SCREEN_WIDTH}
                height={SCREEN_HEIGHT}
                fill="#FFFFFF"
              />
              <AnimatedG animatedProps={animatedHoleProps}>
                <Path d={splashConfig.symbol.path} fill="#000000" />
              </AnimatedG>
            </Mask>
          </Defs>

          <Rect
            x="0"
            y="0"
            width={SCREEN_WIDTH}
            height={SCREEN_HEIGHT}
            fill={splashConfig.colors.brand}
            mask="url(#starRevealWindowMask)"
          />
        </Svg>
      </Animated.View>

      {/* ── LAYER 2: LOGO LAYER ("Sahayak" + Tagline) ── */}
      <Animated.View
        style={[styles.logoLayer, animatedLogoContainerStyle]}
        pointerEvents="none"
      >
        <View style={styles.logoRow}>
          {/* Space allocated for star at resting position so wordmark aligns next to it */}
          <View style={styles.starPlaceholder} />

          {/* WORDMARK: "Sahayak" */}
          <View style={styles.wordmarkWrapper}>
            <Text style={styles.wordmarkText}>
              {splashConfig.content.wordmark}
            </Text>
            {/* Dynamic green erase curtain covering letters to the left of the star */}
            <Animated.View
              style={[styles.eraseCurtain, animatedWordmarkCurtainStyle]}
            />
          </View>
        </View>

        {/* TAGLINE: "10-MINUTE ROADSIDE RESCUE" */}
        <View style={styles.taglineWrapper}>
          <Text style={styles.taglineText}>
            {splashConfig.content.tagline}
          </Text>
          <Animated.View
            style={[styles.eraseCurtain, animatedTaglineCurtainStyle]}
          />
        </View>
      </Animated.View>

      {/* ── LAYER 3: THE STAR OBJECT (FOLLOWS EXACT SPLINE & ROTATION) ── */}
      <Animated.View
        style={[styles.starContainer, animatedStarStyle]}
        pointerEvents="none"
      >
        <Svg
          viewBox={splashConfig.symbol.viewBox}
          style={StyleSheet.absoluteFill}
        >
          <Path
            d={splashConfig.symbol.path}
            fill={splashConfig.colors.text}
          />
        </Svg>
      </Animated.View>

      {/* ── LAYER 4: FOOTER (ICON + ROADSIDE RESCUE / ANYWHERE, ANYTIME) ── */}
      <View style={styles.footerContainer} pointerEvents="none">
        <Ionicons
          name={splashConfig.content.footerIconName}
          size={13}
          color={splashConfig.colors.footerIcon}
          style={styles.footerIcon}
        />
        <Text style={styles.footerTextLine1}>
          {splashConfig.content.footerLine1}
        </Text>
        <Text style={styles.footerTextLine2}>
          {splashConfig.content.footerLine2}
        </Text>
      </View>

      {/* ── FLOATING DEBUG TOGGLE (TOP-RIGHT) ── */}
      <TouchableOpacity
        style={styles.floatingDebugBtn}
        onPress={() => {
          if (!showDebugOverlay) {
            cancelAnimation(timeline);
            setIsPlaying(false);
            setDebugTime(timeline.value);
            setShowDebugOverlay(true);
          } else {
            setShowDebugOverlay(false);
            startSequence(0);
          }
        }}
      >
        <Text style={styles.floatingDebugBtnText}>
          {showDebugOverlay ? "Close ✕" : "🐞 Debug Path"}
        </Text>
      </TouchableOpacity>

      {/* ── 5. DEBUG VISUAL OVERLAY: DOTTED SPLINE PATH & KEYFRAME CIRCLES ── */}
      {showDebugOverlay && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {/* Screen center crosshairs */}
            <Line
              x1={0}
              y1={RESTING_CENTER_Y}
              x2={SCREEN_WIDTH}
              y2={RESTING_CENTER_Y}
              stroke="rgba(255, 255, 255, 0.3)"
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <Line
              x1={RESTING_CENTER_X}
              y1={0}
              x2={RESTING_CENTER_X}
              y2={SCREEN_HEIGHT}
              stroke="rgba(255, 255, 255, 0.3)"
              strokeWidth={1}
              strokeDasharray="4,4"
            />

            {/* Dotted reference spline line */}
            <Path
              d={generateDottedSplinePath()}
              stroke="#FFFFFF"
              strokeWidth={2}
              strokeDasharray="4,4"
              fill="none"
              opacity={0.9}
            />

            {/* Keyframe circles and timestamp labels */}
            {STAR_KEYFRAMES.map((k) => (
              <G key={k.t.toFixed(2)}>
                <Circle
                  cx={k.x * SCREEN_WIDTH}
                  cy={k.y * SCREEN_HEIGHT}
                  r={(k.size * SCREEN_WIDTH) / 2}
                  stroke="rgba(255, 255, 255, 0.7)"
                  strokeWidth={1}
                  fill="rgba(255, 255, 255, 0.05)"
                />
                <Circle
                  cx={k.x * SCREEN_WIDTH}
                  cy={k.y * SCREEN_HEIGHT}
                  r={2.5}
                  fill="#FFFF00"
                />
                <SvgText
                  x={k.x * SCREEN_WIDTH + 4}
                  y={k.y * SCREEN_HEIGHT - 4}
                  fill="#FFFFFF"
                  fontSize={8.5}
                  fontWeight="bold"
                >
                  {k.t.toFixed(2)}s
                </SvgText>
              </G>
            ))}
          </Svg>

          {/* Scrubber Control Panel */}
          <View style={styles.debugControlPanel} pointerEvents="box-none">
            <View style={styles.debugHeaderRow}>
              <Text style={styles.debugTitleText}>
                Scrubber: {debugTime.toFixed(2)}s (t_rel: {tRelCurrent.toFixed(2)}s)
              </Text>
              <TouchableOpacity
                style={styles.debugPlayBtn}
                onPress={() => {
                  if (isPlaying) {
                    cancelAnimation(timeline);
                    setIsPlaying(false);
                  } else {
                    setIsPlaying(true);
                    startSequence(
                      debugTime >= splashConfig.timings.TOTAL_DURATION - 0.05
                        ? 0
                        : debugTime
                    );
                  }
                }}
              >
                <Text style={styles.debugPlayBtnText}>
                  {isPlaying ? "Pause ⏸" : "Play ▶"}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Live Telemetry Data */}
            <View style={styles.telemetryBox}>
              <Text style={styles.telemetryText}>
                x: {(currentPt.x * 100).toFixed(1)}% | y:{" "}
                {(currentPt.y * 100).toFixed(1)}% | size:{" "}
                {(currentPt.size * 100).toFixed(1)}% | rot:{" "}
                {currentRot.toFixed(0)}°
              </Text>
            </View>

            {/* Milestone Jump Buttons */}
            <View style={styles.milestonesRow}>
              {[
                { label: "0.00s Logo", t: 0.0 },
                { label: "0.45s Start", t: splashConfig.timings.T0_MOTION_START },
                { label: "0.58s WordmarkGone", t: splashConfig.timings.T1_WORDMARK_ERASED },
                { label: "0.65s Apex", t: splashConfig.timings.T2_ALL_ERASED },
                { label: "1.12s Center", t: splashConfig.timings.T3_SPIRAL_END },
                { label: "1.29s Shrink", t: splashConfig.timings.T4_STILL_END },
                { label: "1.42s Pop", t: splashConfig.timings.T6_POP_END },
                { label: "1.48s Half", t: splashConfig.timings.T8_HALF_SCREEN },
                { label: "1.58s Corners", t: splashConfig.timings.T10_CORNERS_ONLY },
                { label: "1.68s Reveal", t: splashConfig.timings.T11_COMPLETE },
              ].map((m) => (
                <TouchableOpacity
                  key={m.label}
                  style={[
                    styles.milestoneBtn,
                    Math.abs(debugTime - m.t) < 0.03 &&
                      styles.milestoneBtnActive,
                  ]}
                  onPress={() => handleScrub(m.t)}
                >
                  <Text style={styles.milestoneBtnText}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Center logo layer
  logoLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 20, // Centers wordmark vertically around 49%
    zIndex: 10,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  starPlaceholder: {
    width: 34,
    height: 34,
    marginRight: 10,
  },
  wordmarkWrapper: {
    position: "relative",
    overflow: "hidden",
    justifyContent: "center",
  },
  wordmarkText: {
    fontSize: 48,
    fontWeight: "900",
    color: splashConfig.colors.text,
    letterSpacing: -1.2,
    lineHeight: 52,
  },
  taglineWrapper: {
    position: "relative",
    overflow: "hidden",
    marginTop: 26,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  taglineText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: splashConfig.colors.tagline,
    letterSpacing: 2.8,
    textTransform: "uppercase",
    textAlign: "center",
  },
  eraseCurtain: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: splashConfig.colors.brand,
    zIndex: 2,
  },

  // Star container
  starContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 20,
    shadowColor: "#FFFFFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 10,
    elevation: 8,
  },

  // Minimal footer: positioned at 81.0% down from top matching reference screenshot exactly
  footerContainer: {
    position: "absolute",
    top: SCREEN_HEIGHT * splashConfig.layout.footerTopPercent,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  footerIcon: {
    marginBottom: 4,
  },
  footerTextLine1: {
    fontSize: 11.5,
    fontWeight: "700",
    color: splashConfig.colors.footerText,
    letterSpacing: 0.2,
    textAlign: "center",
    lineHeight: 16,
  },
  footerTextLine2: {
    fontSize: 11.5,
    fontWeight: "600",
    color: splashConfig.colors.footerText,
    letterSpacing: 0.2,
    textAlign: "center",
    lineHeight: 16,
    opacity: 0.95,
  },

  // Floating debug button
  floatingDebugBtn: {
    position: "absolute",
    top: Platform.OS === "android" ? 36 : 48,
    right: 14,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    zIndex: 99999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  floatingDebugBtnText: {
    color: "#FFFFFF",
    fontSize: 10.5,
    fontWeight: "800",
  },

  // Debug scrubber controls
  debugControlPanel: {
    position: "absolute",
    bottom: 20,
    left: 10,
    right: 10,
    backgroundColor: "rgba(0, 0, 0, 0.92)",
    borderRadius: 14,
    padding: 10,
    zIndex: 9999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  debugHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  debugTitleText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  debugPlayBtn: {
    backgroundColor: splashConfig.colors.brand,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  debugPlayBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
  },
  telemetryBox: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginBottom: 8,
    alignItems: "center",
  },
  telemetryText: {
    color: "#FFFF00",
    fontSize: 10,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    fontWeight: "700",
  },
  milestonesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  milestoneBtn: {
    backgroundColor: "#333333",
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  milestoneBtnActive: {
    backgroundColor: splashConfig.colors.brand,
  },
  milestoneBtnText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },
});
