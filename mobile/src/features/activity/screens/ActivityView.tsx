// ─── Sahayak — Activity Screen (Rescues) ──────────────────────────────────────
// Redesigned with the clean, flat grouped-card design language of AccountView.
// Replaces cluttered AI boxes with clean, structured white cards, dividers, and badges.

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Dimensions,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "../../../constants/theme";
import type { ServiceType } from "../../../types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface ActivityViewProps {
  onLaunchService: (service: ServiceType, title?: string) => void;
  onOpenSos: () => void;
  searchQuery?: string;
}

interface ActivityItem {
  id: string;
  serviceType: ServiceType;
  serviceTitle: string;
  vehicle: string;
  plate: string;
  date: string;
  location: string;
  destination?: string;
  price: number;
  paymentMethod: string;
  partnerName: string;
  partnerVehicle: string;
  rating: number;
  otp: string;
  status: "completed" | "cancelled" | "upcoming";
  invoiceId: string;
  basePrice: number;
  tax: number;
  iconName: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
}

const PAST_ACTIVITIES: ActivityItem[] = [
  {
    id: "act_01",
    serviceType: "battery",
    serviceTitle: "Battery Jumpstart Booster",
    vehicle: "Maruti Suzuki Swift",
    plate: "KA 05 MN 1234",
    date: "Today, 2:15 PM",
    location: "Indiranagar 100 Feet Rd, near 12th Main",
    price: 249,
    paymentMethod: "Google Pay UPI",
    partnerName: "Ramesh Kumar",
    partnerVehicle: "Tata 407 Rapid Fleet",
    rating: 5.0,
    otp: "4821",
    status: "completed",
    invoiceId: "SHK-2026-98421",
    basePrice: 220,
    tax: 29,
    iconName: "flash",
    iconBg: "#FEF6D8",
    iconColor: "#C2850C",
  },
  {
    id: "act_02",
    serviceType: "tyre",
    serviceTitle: "Tubeless Puncture & Wheel Swap",
    vehicle: "Royal Enfield Classic 350",
    plate: "KA 01 AB 5678",
    date: "26 Sep 2026, 6:40 PM",
    location: "Hebbal Flyover Junction, Expressway Lane",
    price: 199,
    paymentMethod: "Sahayak Cash",
    partnerName: "Suresh Manjunath",
    partnerVehicle: "Mobile Tyre Van #04",
    rating: 5.0,
    otp: "7103",
    status: "completed",
    invoiceId: "SHK-2026-87112",
    basePrice: 175,
    tax: 24,
    iconName: "disc",
    iconBg: "#E6F4EA",
    iconColor: "#0C831F",
  },
  {
    id: "act_03",
    serviceType: "towing",
    serviceTitle: "Flatbed Tow Truck",
    vehicle: "Maruti Suzuki Swift",
    plate: "KA 05 MN 1234",
    date: "12 Sep 2026, 11:15 AM",
    location: "Outer Ring Road, Bellandur Junction",
    destination: "Maruti Authorized Service Center, Domlur (14 km)",
    price: 549,
    paymentMethod: "HDFC Debit Card (RSA Discount)",
    partnerName: "CityWide Rescue Towing",
    partnerVehicle: "Ashok Leyland Tilt-Deck #12",
    rating: 4.8,
    otp: "9354",
    status: "completed",
    invoiceId: "SHK-2026-72409",
    basePrice: 480,
    tax: 69,
    iconName: "car-sport",
    iconBg: "#F0F2F5",
    iconColor: "#1C1C1C",
  },
];

export default function ActivityView({
  onLaunchService,
  onOpenSos,
  searchQuery = "",
}: ActivityViewProps) {
  const [selectedTab, setSelectedTab] = useState<"past" | "upcoming">("past");
  const [receiptItem, setReceiptItem] = useState<ActivityItem | null>(null);

  const query = searchQuery.trim().toLowerCase();
  const filteredActivities = PAST_ACTIVITIES.filter((item) => {
    if (!query) return true;
    return (
      item.serviceTitle.toLowerCase().includes(query) ||
      item.vehicle.toLowerCase().includes(query) ||
      item.plate.toLowerCase().includes(query) ||
      item.invoiceId.toLowerCase().includes(query) ||
      item.location.toLowerCase().includes(query)
    );
  });

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. THREE SUMMARY PILL CARDS (MATCHING ACCOUNT VIEW 3-CARD ROW) ── */}
        <View style={styles.cardsRowWrapper}>
          <View style={styles.threeCardItem}>
            <View style={styles.threeCardIconBox}>
              <Ionicons name="shield-checkmark" size={24} color="#0C831F" />
            </View>
            <Text style={styles.threeCardTitle}>3 Rescues</Text>
            <Text style={styles.threeCardSub}>All successful</Text>
          </View>

          <View style={styles.threeCardItem}>
            <View style={styles.threeCardIconBox}>
              <Ionicons name="wallet-outline" size={24} color="#1C1C1C" />
            </View>
            <Text style={styles.threeCardTitle}>₹450 Saved</Text>
            <Text style={styles.threeCardSub}>RSA benefits</Text>
          </View>

          <TouchableOpacity
            style={styles.threeCardItem}
            onPress={() => {
              Alert.alert(
                "24/7 Roadside Emergency Desk 🇮🇳",
                "Toll-Free Helpline: 1800-SAHAYAK (1800-724-2925)\nWhatsApp Help: +91 80 4921 5500\n\nVerified technicians & towing fleet on standby across India."
              );
            }}
            activeOpacity={0.8}
          >
            <View style={styles.threeCardIconBox}>
              <Ionicons name="call-outline" size={24} color="#C2850C" />
            </View>
            <Text style={styles.threeCardTitle}>Need Help?</Text>
            <Text style={styles.threeCardSub}>24/7 Desk</Text>
          </TouchableOpacity>
        </View>

        {/* ── 2. SEGMENTED TABS (CLEAN CAPSULE MATCHING ACCOUNT VIEW) ── */}
        <View style={styles.sectionMargin}>
          <View style={styles.segmentedContainer}>
            <TouchableOpacity
              style={[styles.segmentBtn, selectedTab === "past" && styles.segmentBtnActive]}
              onPress={() => setSelectedTab("past")}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.segmentText,
                  selectedTab === "past" && styles.segmentTextActive,
                ]}
              >
                Past rescues ({filteredActivities.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.segmentBtn,
                selectedTab === "upcoming" && styles.segmentBtnActive,
              ]}
              onPress={() => setSelectedTab("upcoming")}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.segmentText,
                  selectedTab === "upcoming" && styles.segmentTextActive,
                ]}
              >
                Active rescue (0)
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 3. UPCOMING / ACTIVE TAB (EMPTY STATE IN CLEAN WHITE CARD) ── */}
        {selectedTab === "upcoming" && (
          <View style={styles.sectionMargin}>
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="shield-checkmark" size={28} color="#0C831F" />
              </View>
              <Text style={styles.emptyTitle}>No active rescue in progress</Text>
              <Text style={styles.emptySub}>
                All registered vehicles are currently safe. Help is on standby 24/7 if you ever face a breakdown.
              </Text>

              <TouchableOpacity
                style={styles.emergencyCtaBtn}
                onPress={() => onLaunchService("towing", "Flatbed Tow Truck")}
                activeOpacity={0.85}
              >
                <Ionicons name="flash" size={15} color="#1C1C1C" />
                <Text style={styles.emergencyCtaText}>Request Instant Help</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── 4. PAST RESCUES LIST (CLEAN GROUPED CARDS MATCHING ACCOUNT VIEW) ── */}
        {selectedTab === "past" && (
          <View style={styles.sectionMargin}>
            <Text style={styles.sectionGroupTitle}>Rescue History</Text>

            {filteredActivities.map((item) => (
              <View key={item.id} style={styles.activityCard}>
                {/* Header Row: Service Icon + Title + Status + Price */}
                <View style={styles.cardHeaderRow}>
                  <View style={[styles.serviceIconCircle, { backgroundColor: item.iconBg }]}>
                    <Ionicons name={item.iconName} size={18} color={item.iconColor} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.serviceTitle}>{item.serviceTitle}</Text>
                    <Text style={styles.vehiclePlate}>
                      {item.vehicle} · {item.plate}
                    </Text>
                  </View>

                  <View style={styles.headerRight}>
                    <Text style={styles.priceAmount}>₹{item.price}</Text>
                    <View style={styles.statusChip}>
                      <Ionicons name="checkmark-circle" size={11} color="#0C831F" />
                      <Text style={styles.statusChipText}>Completed</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.cardDivider} />

                {/* Location & Trip Details */}
                <View style={styles.detailsSection}>
                  <View style={styles.detailRow}>
                    <Ionicons name="location-sharp" size={15} color="#5E6470" />
                    <Text style={styles.detailText} numberOfLines={1}>
                      {item.location}
                    </Text>
                  </View>
                  {item.destination && (
                    <View style={[styles.detailRow, { marginTop: 4 }]}>
                      <Ionicons name="flag-sharp" size={15} color="#0C831F" />
                      <Text style={styles.detailText} numberOfLines={1}>
                        {item.destination}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.detailRow, { marginTop: 4 }]}>
                    <Ionicons name="time-outline" size={15} color="#8C93A3" />
                    <Text style={styles.dateText}>{item.date}</Text>
                  </View>
                </View>

                <View style={styles.cardDivider} />

                {/* Partner Details & Bottom Actions */}
                <View style={styles.cardBottomRow}>
                  <View style={styles.partnerInfo}>
                    <Ionicons name="person-circle-outline" size={18} color="#1C1C1C" />
                    <Text style={styles.partnerNameText}>{item.partnerName}</Text>
                    <View style={styles.starBadge}>
                      <Ionicons name="star" size={10} color="#F8CB46" />
                      <Text style={styles.starText}>{item.rating.toFixed(1)}</Text>
                    </View>
                  </View>

                  <View style={styles.actionButtons}>
                    <TouchableOpacity
                      style={styles.invoiceBtn}
                      onPress={() => setReceiptItem(item)}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="receipt-outline" size={14} color="#1C1C1C" />
                      <Text style={styles.invoiceBtnText}>Invoice</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.rebookBtn}
                      onPress={() => onLaunchService(item.serviceType, item.serviceTitle)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="repeat" size={13} color="#FFFFFF" />
                      <Text style={styles.rebookBtnText}>Book Again</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── 5. OFFICIAL GST RECEIPT MODAL ── */}
      <Modal
        visible={!!receiptItem}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setReceiptItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.receiptModalCard}>
            <View style={styles.receiptHeader}>
              <View>
                <Text style={styles.receiptBrand}>SAHAYAK 🇮🇳</Text>
                <Text style={styles.receiptSub}>Official Roadside Tax Invoice · GSTIN 29AABCS1429B1Z8</Text>
              </View>
              <TouchableOpacity
                onPress={() => setReceiptItem(null)}
                style={styles.receiptCloseBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color="#1C1C1C" />
              </TouchableOpacity>
            </View>

            {receiptItem && (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
                {/* Invoice Meta */}
                <View style={styles.invoiceMetaCard}>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Invoice No:</Text>
                    <Text style={styles.metaVal}>{receiptItem.invoiceId}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Date & Time:</Text>
                    <Text style={styles.metaVal}>{receiptItem.date}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Registered Vehicle:</Text>
                    <Text style={styles.metaVal}>{receiptItem.plate}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Assigned Partner:</Text>
                    <Text style={styles.metaVal}>{receiptItem.partnerName}</Text>
                  </View>
                </View>

                {/* Line Items */}
                <Text style={styles.breakdownHeader}>Cost Breakdown</Text>
                <View style={styles.billTable}>
                  <View style={styles.billRow}>
                    <Text style={styles.billItemTitle}>{receiptItem.serviceTitle}</Text>
                    <Text style={styles.billItemPrice}>₹{receiptItem.basePrice}</Text>
                  </View>
                  <View style={styles.billRow}>
                    <Text style={styles.billItemSub}>On-Site Rapid Response Dispatch</Text>
                    <Text style={[styles.billItemPrice, { color: "#0C831F" }]}>FREE</Text>
                  </View>
                  <View style={styles.billRow}>
                    <Text style={styles.billItemSub}>Platform & Safety Fee</Text>
                    <Text style={styles.billItemPrice}>₹0</Text>
                  </View>
                  <View style={styles.billRow}>
                    <Text style={styles.billItemSub}>GST (18% inclusive)</Text>
                    <Text style={styles.billItemPrice}>₹{receiptItem.tax}</Text>
                  </View>

                  <View style={styles.billDivider} />

                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total Amount Paid</Text>
                    <Text style={styles.totalAmount}>₹{receiptItem.price}</Text>
                  </View>

                  <View style={styles.paymentMethodRow}>
                    <Ionicons name="card-outline" size={14} color="#5E6470" />
                    <Text style={styles.paymentMethodText}>
                      Paid via {receiptItem.paymentMethod}
                    </Text>
                  </View>
                </View>
              </ScrollView>
            )}

            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => {
                Alert.alert(
                  "Invoice Saved",
                  "A copy of this GST invoice has been emailed to your registered address."
                );
                setReceiptItem(null);
              }}
              activeOpacity={0.88}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F6F8",
  },
  scroll: {
    flex: 1,
    backgroundColor: "#F5F6F8",
  },
  scrollContent: {
    paddingBottom: 110,
  },

  // 1. Three Summary Pill Cards (Exact Account View threeCardItem Match)
  cardsRowWrapper: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 10,
    marginTop: 14,
  },
  threeCardItem: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#EFF1F5",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  threeCardIconBox: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  threeCardTitle: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    textAlign: "center",
  },
  threeCardSub: {
    fontSize: 10.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 1,
    textAlign: "center",
  },

  // Section Margins
  sectionMargin: {
    paddingHorizontal: 16,
    marginTop: 14,
  },
  sectionGroupTitle: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    marginBottom: 8,
    letterSpacing: -0.2,
  },

  // 2. Segmented Pill Tabs
  segmentedContainer: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 3,
    borderWidth: 1,
    borderColor: "#EFF1F5",
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnActive: {
    backgroundColor: "#1C1C1C",
  },
  segmentText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "500",
    color: "#5E6470",
  },
  segmentTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  // 3. Empty State Card
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#EFF1F5",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#E6F4EA",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    textAlign: "center",
  },
  emptySub: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    textAlign: "center",
    marginTop: 4,
    lineHeight: 17,
  },
  emergencyCtaBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8CB46",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 16,
    gap: 6,
  },
  emergencyCtaText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },

  // 4. Past Rescues List (Grouped Cards matching Account View)
  activityCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    overflow: "hidden",
    marginBottom: 12,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  serviceIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  serviceTitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  vehiclePlate: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.medium,
    color: "#5E6470",
    marginTop: 2,
  },
  headerRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  priceAmount: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E6F4EA",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
  },
  statusChipText: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#0C831F",
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#F0F2F5",
    marginHorizontal: 14,
  },
  detailsSection: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  detailText: {
    flex: 1,
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#475569",
  },
  dateText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.medium,
    color: "#8C93A3",
  },
  cardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#FAFBFD",
  },
  partnerInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  partnerNameText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "600",
    color: "#1C1C1C",
  },
  starBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#FEF6D8",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  starText: {
    fontSize: 9.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  invoiceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  invoiceBtnText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#1C1C1C",
  },
  rebookBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#1C1C1C",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  rebookBtnText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // 5. Receipt Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  receiptModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
  },
  receiptHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  receiptBrand: {
    fontSize: 18,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },
  receiptSub: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 2,
  },
  receiptCloseBtn: {
    padding: 4,
  },
  invoiceMetaCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#EFF1F5",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  metaLabel: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.medium,
    color: "#64748B",
  },
  metaVal: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "600",
    color: "#1C1C1C",
  },
  breakdownHeader: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    marginBottom: 8,
  },
  billTable: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    padding: 14,
  },
  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  billItemTitle: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.medium,
    color: "#1C1C1C",
  },
  billItemSub: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
  },
  billItemPrice: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.medium,
    color: "#1C1C1C",
  },
  billDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E2E8F0",
    marginVertical: 10,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  totalLabel: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  totalAmount: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },
  paymentMethodRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#F1F5F9",
  },
  paymentMethodText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.medium,
    color: "#64748B",
  },
  doneBtn: {
    backgroundColor: "#1C1C1C",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  doneBtnText: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
