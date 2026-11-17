// ─── Collapsing hero: the dark header scrolls away with the content ──────────
// A shell (owner / partner) wraps its tabs in <HeroShell hero={<ScreenHero …/>}>.
// Each tab scrolls with <HeroScrollView> (or <HeroFlatList>), which renders the
// hero as its first child, so the big header moves up with the page. Once it
// is mostly gone, a slim "Sahayak" bar fades in and stays pinned at the top.
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  Animated,
  View,
  Text,
  StyleSheet,
  type FlatListProps,
  type ScrollViewProps,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography, Spacing, Hero } from "../../constants/theme";
import { HeroIconButton, type HeroAction } from "./ScreenHero";

type Ctx = { scrollY: Animated.Value; hero: React.ReactNode };
const HeroCtx = createContext<Ctx | null>(null);

/** Scroll distance after which the slim bar is fully shown. */
const SHOW_FROM = 70;
const SHOW_AT = 130;

export function HeroShell({
  hero,
  title = "Sahayak",
  left,
  right,
  resetKey,
  children,
}: {
  hero: React.ReactNode;
  title?: string;
  left?: React.ReactNode;
  right?: HeroAction;
  /** Change it (e.g. the active tab) to put the slim bar away again. */
  resetKey?: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => setShown(value > SHOW_FROM + 20));
    return () => scrollY.removeListener(id);
  }, [scrollY]);

  useEffect(() => {
    scrollY.setValue(0);
  }, [resetKey, scrollY]);

  const opacity = scrollY.interpolate({ inputRange: [SHOW_FROM, SHOW_AT], outputRange: [0, 1], extrapolate: "clamp" });

  return (
    <HeroCtx.Provider value={{ scrollY, hero }}>
      <View style={{ flex: 1 }}>
        {children}
        <Animated.View
          pointerEvents={shown ? "auto" : "none"}
          style={[styles.mini, { paddingTop: insets.top, opacity }]}
          accessibilityElementsHidden={!shown}
          importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
        >
          <View style={styles.miniRow}>
            <View style={styles.miniBrand}>
              {left}
              <Text style={styles.miniTitle} numberOfLines={1}>{title}</Text>
            </View>
            {right ? <HeroIconButton {...right} /> : null}
          </View>
        </Animated.View>
      </View>
    </HeroCtx.Provider>
  );
}

function useScrollHandler(onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void) {
  const ctx = useContext(HeroCtx);
  if (!ctx) return { ctx, handler: onScroll };
  const handler = Animated.event([{ nativeEvent: { contentOffset: { y: ctx.scrollY } } }], {
    useNativeDriver: true,
    listener: onScroll,
  });
  return { ctx, handler };
}

/** Drop-in ScrollView whose first child is the shell's hero. */
export function HeroScrollView({ children, contentContainerStyle, onScroll, ...rest }: ScrollViewProps) {
  const { ctx, handler } = useScrollHandler(onScroll ?? undefined);
  return (
    <Animated.ScrollView {...rest} onScroll={handler as any} scrollEventThrottle={16}>
      {ctx?.hero}
      <View style={contentContainerStyle}>{children}</View>
    </Animated.ScrollView>
  );
}

/** FlatList variant: the hero sits above the list header. */
export function HeroFlatList<T>({ ListHeaderComponent, onScroll, ...rest }: FlatListProps<T>) {
  const { ctx, handler } = useScrollHandler(onScroll ?? undefined);
  const Header = ListHeaderComponent;
  return (
    <Animated.FlatList
      {...(rest as any)}
      onScroll={handler as any}
      scrollEventThrottle={16}
      ListHeaderComponent={
        <>
          {ctx?.hero}
          {Header ? (React.isValidElement(Header) ? Header : React.createElement(Header as React.ComponentType)) : null}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  mini: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: Hero.bg,
    paddingHorizontal: Spacing.screenHorizontal,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  miniRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52 },
  miniBrand: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  miniTitle: { color: "#fff", fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.semiBold },
});

