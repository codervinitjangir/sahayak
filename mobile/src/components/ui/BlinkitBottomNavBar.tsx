// ─── BlinkitBottomNavBar.tsx ──────────────────────────────────────────────────
// Authentic Blinkit Dynamic Bottom Navigation Bar
// Features:
// 1. Floating white rounded capsule container with deep subtle elevation
// 2. Soft grey capsule pill (#E8EAED) around active tab
// 3. Dynamic Yellow & Black dual-tone icons:
//    - Home: Yellow filled house + black outline + black arched door
//    - Services: 2x2 dynamic yellow and black checkerboard circles
//    - Rescues: Solid black bag + yellow rim accent + vibrant yellow filled heart
//    - Account: Yellow filled avatar head + black body arc + yellow dot
// 4. Spring micro-interactions when switching tabs

import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "../../constants/theme";

export type BottomTab = "home" | "services" | "activity" | "account";

interface BlinkitBottomNavBarProps {
  activeTab: BottomTab;
  onTabPress: (tab: BottomTab) => void;
}

// ─── DYNAMIC ICONS (YELLOW & BLACK) ──────────────────────────────────────────

// 1. HOME ICON (Blinkit Screenshot Exact Match)
function HomeIcon({ active }: { active: boolean }) {
  if (!active) {
    return <Ionicons name="home-outline" size={24} color="#1C1C1C" />;
  }

  return (
    <View style={iconStyles.iconBox}>
      {/* Outer black silhouette/stroke base */}
      <Ionicons name="home" size={25} color="#1C1C1C" style={iconStyles.absolute} />
      {/* Inner vibrant Blinkit Yellow fill */}
      <Ionicons name="home" size={22} color="#F8CB46" style={iconStyles.absolute} />
      {/* Cutout arched dark doorway at bottom center */}
      <View style={iconStyles.homeDoor} />
    </View>
  );
}

// 2. SERVICES ICON (Blinkit Categories 2x2 Grid Exact Match)
function ServicesIcon({ active }: { active: boolean }) {
  if (!active) {
    return (
      <View style={iconStyles.grid2x2}>
        <View style={iconStyles.gridCircleOutline} />
        <View style={iconStyles.gridCircleOutline} />
        <View style={iconStyles.gridCircleOutline} />
        <View style={iconStyles.gridCircleOutline} />
      </View>
    );
  }

  // Active: Dynamic Yellow & Black checkerboard
  return (
    <View style={iconStyles.grid2x2}>
      <View style={[iconStyles.gridCircle, iconStyles.circleYellow]} />
      <View style={[iconStyles.gridCircle, iconStyles.circleBlack]} />
      <View style={[iconStyles.gridCircle, iconStyles.circleBlack]} />
      <View style={[iconStyles.gridCircle, iconStyles.circleYellow]} />
    </View>
  );
}

// 3. RESCUES ICON (Blinkit Order Again Bag Exact Match)
function RescuesIcon({ active }: { active: boolean }) {
  if (!active) {
    return <Ionicons name="bag-handle-outline" size={24} color="#1C1C1C" />;
  }

  // Active: Black bag + Yellow rim + Yellow heart in center
  return (
    <View style={iconStyles.bagContainer}>
      {/* Handle loop on top */}
      <View style={iconStyles.bagHandle} />
      {/* Bag body */}
      <View style={iconStyles.bagBody}>
        {/* Yellow top accent rim */}
        <View style={iconStyles.bagRim} />
        {/* Yellow filled heart in center */}
        <Ionicons name="heart" size={9} color="#F8CB46" style={{ marginTop: 2 }} />
      </View>
    </View>
  );
}

// 4. ACCOUNT ICON (Dynamic Yellow & Black Avatar)
function AccountIcon({ active }: { active: boolean }) {
  if (!active) {
    return <Ionicons name="person-outline" size={23} color="#1C1C1C" />;
  }

  return (
    <View style={iconStyles.iconBox}>
      {/* Head: Yellow circle with crisp dark stroke */}
      <View style={iconStyles.avatarHead} />
      {/* Shoulders: Solid dark charcoal arc */}
      <View style={iconStyles.avatarBody} />
      {/* Yellow notification dot */}
      <View style={iconStyles.avatarBadge} />
    </View>
  );
}

// ─── TAB ITEM COMPONENT WITH SPRING ANIMATION ────────────────────────────────

interface TabItemProps {
  tabKey: BottomTab;
  label: string;
  isActive: boolean;
  onPress: () => void;
  renderIcon: (active: boolean) => React.ReactNode;
}

function TabItem({ tabKey, label, isActive, onPress, renderIcon }: TabItemProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isActive) {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 4,
          tension: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isActive]);

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      style={styles.tabTouchWrapper}
    >
      <Animated.View
        style={[
          styles.tabPill,
          isActive && styles.tabPillActive,
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        <View style={styles.iconWrapper}>{renderIcon(isActive)}</View>
        <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── MAIN BLINKIT BOTTOM NAV BAR ─────────────────────────────────────────────

export default function BlinkitBottomNavBar({
  activeTab,
  onTabPress,
}: BlinkitBottomNavBarProps) {
  const insets = useSafeAreaInsets();
  const bottomInset = insets.bottom > 0 ? insets.bottom : Platform.OS === "android" ? 10 : 16;

  const TABS: {
    key: BottomTab;
    label: string;
    renderIcon: (active: boolean) => React.ReactNode;
  }[] = [
    {
      key: "home",
      label: "Home",
      renderIcon: (active) => <HomeIcon active={active} />,
    },
    {
      key: "services",
      label: "Services",
      renderIcon: (active) => <ServicesIcon active={active} />,
    },
    {
      key: "activity",
      label: "Rescues",
      renderIcon: (active) => <RescuesIcon active={active} />,
    },
    {
      key: "account",
      label: "Account",
      renderIcon: (active) => <AccountIcon active={active} />,
    },
  ];

  return (
    <View style={[styles.outerContainer, { paddingBottom: bottomInset }]}>
      <View style={styles.floatingNavCard}>
        {TABS.map((tab) => (
          <TabItem
            key={tab.key}
            tabKey={tab.key}
            label={tab.label}
            isActive={activeTab === tab.key}
            onPress={() => onTabPress(tab.key)}
            renderIcon={tab.renderIcon}
          />
        ))}
      </View>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  outerContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    zIndex: 999,
  },
  floatingNavCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 36,
    paddingHorizontal: 6,
    paddingVertical: 5,
    marginHorizontal: 16,
    width: "92%",
    maxWidth: 420,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
  },
  tabTouchWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabPill: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 26,
    minWidth: 70,
    gap: 3,
  },
  tabPillActive: {
    backgroundColor: "#E8EAED", // Blinkit soft grey capsule background
  },
  iconWrapper: {
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "500",
    color: "#1C1C1C",
    letterSpacing: -0.2,
  },
  tabLabelActive: {
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },
});

const iconStyles = StyleSheet.create({
  iconBox: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  absolute: {
    position: "absolute",
  },
  homeDoor: {
    width: 7,
    height: 8,
    backgroundColor: "#1C1C1C",
    borderTopLeftRadius: 3.5,
    borderTopRightRadius: 3.5,
    position: "absolute",
    bottom: 2,
  },
  grid2x2: {
    width: 22,
    height: 22,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignContent: "space-between",
    padding: 1.5,
  },
  gridCircleOutline: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.8,
    borderColor: "#1C1C1C",
  },
  gridCircle: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  circleYellow: {
    backgroundColor: "#F8CB46",
    borderWidth: 1.2,
    borderColor: "#1C1C1C",
  },
  circleBlack: {
    backgroundColor: "#1C1C1C",
  },
  bagContainer: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  bagHandle: {
    width: 12,
    height: 8,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderWidth: 2,
    borderBottomWidth: 0,
    borderColor: "#1C1C1C",
    marginBottom: -1,
  },
  bagBody: {
    width: 22,
    height: 16,
    backgroundColor: "#1C1C1C",
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  bagRim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2.5,
    backgroundColor: "#F8CB46",
  },
  avatarHead: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: "#F8CB46",
    borderWidth: 1.4,
    borderColor: "#1C1C1C",
    marginBottom: 1,
  },
  avatarBody: {
    width: 17,
    height: 9,
    borderTopLeftRadius: 8.5,
    borderTopRightRadius: 8.5,
    backgroundColor: "#1C1C1C",
  },
  avatarBadge: {
    position: "absolute",
    top: 0,
    right: 1,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#F8CB46",
    borderWidth: 1,
    borderColor: "#1C1C1C",
  },
});
