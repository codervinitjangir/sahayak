// ─── Sahayak — Activity Screen (Blinkit Exact Theme & Spacing) ────────────────
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
        {/* ── 1. SEGMENTED TABS (CLEAN PILL STYLE) ── */}
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

        {/* ── 3. UPCOMING / ACTIVE TAB (EMPTY STATE IN BLINKIT WHITE CARD) ── */}
        {selectedTab === "upcoming" && (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="shield-checkmark" size={32} color="#0C831F" />
            </View>
            <Text style={styles.emptyTitle}>No active rescue request</Text>
            <Text style={styles.emptySub}>
              All registered vehicles are currently safe. Help is on standby 24/7 if you ever face a breakdown.
            </Text>

            <TouchableOpacity
              style={styles.emergencyCtaBtn}
              onPress={() => onLaunchService("towing", "Flatbed Tow Truck")}
              activeOpacity={0.88}
            >
              <Ionicons name="car-sport" size={16} color="#FFFFFF" />
              <Text style={styles.emergencyCtaText}>Request Roadside Assist</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 4. PAST RESCUES LIST (CLEAN 16PX WHITE CARDS) ── */}
        {selectedTab === "past" && (
          <View style={styles.activityList}>
            {filteredActivities.map((item) => (
              <View key={item.id} style={styles.activityCard}>
                {/* Top Badge & Time */}
                <View style={styles.cardHeaderRow}>
                  <View style={styles.statusBadge}>
                    <Ionicons name="checkmark-circle" size={12} color="#0C831F" />
                    <Text style={styles.statusBadgeText}>Completed</Text>
                  </View>
                  <Text style={styles.dateTimeText}>{item.date}</Text>
                </View>

                {/* Service & Price */}
                <View style={styles.serviceTitleRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.serviceTitle}>{item.serviceTitle}</Text>
                    <Text style={styles.vehiclePlate}>
                      {item.vehicle} · {item.plate}
                    </Text>
                  </View>
                  <Text style={styles.priceAmount}>₹{item.price}</Text>
                </View>

                {/* Location Points */}
                <View style={styles.locationContainer}>
                  <View style={styles.locRow}>
                    <View style={styles.pickupDot} />
                    <Text style={styles.locText} numberOfLines={1}>
                      {item.location}
                    </Text>
                  </View>
                  {item.destination && (
                    <View style={[styles.locRow, { marginTop: 6 }]}>
                      <View style={styles.destDot} />
                      <Text style={styles.locText} numberOfLines={1}>
                        {item.destination}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Partner Details */}
                <View style={styles.partnerInfoRow}>
                  <View style={styles.partnerAvatarCircle}>
                    <Text style={styles.partnerInitials}>
                      {item.partnerName.charAt(0)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.partnerNameText}>{item.partnerName}</Text>
                    <Text style={styles.partnerVehicleText}>{item.partnerVehicle}</Text>
                  </View>

                  <View style={styles.ratingBadge}>
                    <Ionicons name="star" size={12} color="#F8CB46" />
                    <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
                  </View>
                </View>

                {/* Action Buttons: Tax Invoice & Rebook */}
                <View style={styles.cardActionsRow}>
                  <TouchableOpacity
                    style={styles.receiptBtn}
                    onPress={() => setReceiptItem(item)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="receipt-outline" size={15} color="#1C1C1C" />
                    <Text style={styles.receiptBtnText}>Tax Invoice</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.rebookBtn}
                    onPress={() => onLaunchService(item.serviceType, item.serviceTitle)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="repeat" size={15} color="#FFFFFF" />
                    <Text style={styles.rebookBtnText}>Book Again</Text>
                  </TouchableOpacity>
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
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 100,
  },

  // 1. Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  screenTitle: {
    fontSize: 22,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    letterSpacing: -0.4,
  },
  screenSubtitle: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "500",
    color: "#5E6470",
    marginTop: 3,
  },
  sosButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1C",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E23744",
    gap: 4,
    elevation: 2,
  },
  sosButtonText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    color: "#E23744",
    letterSpacing: 0.5,
  },

  // 2. Segmented Tabs
  segmentedContainer: {
    flexDirection: "row",
    backgroundColor: "#E2E5EB",
    borderRadius: 16,
    padding: 3,
    marginBottom: 14,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnActive: {
    backgroundColor: "#FFFFFF",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
  },
  segmentText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "500",
    color: "#5E6470",
  },
  segmentTextActive: {
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },

  // 3. Empty State Card
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: "center",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    marginTop: 10,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#E6F4EA",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 20,
  },
  emergencyCtaBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1C",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 20,
    gap: 8,
  },
  emergencyCtaText: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // 4. Activity List
  activityList: {
    gap: 12,
  },
  activityCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    padding: 14,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E6F4EA",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#0C831F",
  },
  dateTimeText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
  },

  serviceTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  serviceTitle: {
    fontSize: 15.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    letterSpacing: -0.2,
  },
  vehiclePlate: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 2,
  },
  priceAmount: {
    fontSize: 16.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },

  locationContainer: {
    backgroundColor: "#F5F6F8",
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  locRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pickupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0C831F",
  },
  destDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#E23744",
  },
  locText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#1C1C1C",
    flex: 1,
  },

  partnerInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#F0F2F5",
    paddingTop: 10,
    marginBottom: 12,
    gap: 10,
  },
  partnerAvatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1C1C1C",
    alignItems: "center",
    justifyContent: "center",
  },
  partnerInitials: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  partnerNameText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  partnerVehicleText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF6D8",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 3,
  },
  ratingText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },

  cardActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  receiptBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F5F6F8",
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    gap: 6,
  },
  receiptBtnText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#1C1C1C",
  },
  rebookBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1C1C1C",
    paddingVertical: 9,
    borderRadius: 20,
    gap: 6,
  },
  rebookBtnText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // 5. Official Receipt Modal
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
    maxHeight: "85%",
  },
  receiptHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#F0F2F5",
    paddingBottom: 14,
    marginBottom: 14,
  },
  receiptBrand: {
    fontSize: 18,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },
  receiptSub: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 2,
  },
  receiptCloseBtn: {
    padding: 4,
  },
  invoiceMetaCard: {
    backgroundColor: "#F5F6F8",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: "#EFF1F5",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metaLabel: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
  },
  metaVal: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#1C1C1C",
  },
  breakdownHeader: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    marginBottom: 10,
  },
  billTable: {
    borderWidth: 1,
    borderColor: "#EFF1F5",
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    backgroundColor: "#FFFFFF",
  },
  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  billItemTitle: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  billItemSub: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
  },
  billItemPrice: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#1C1C1C",
  },
  billDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#F0F2F5",
    marginVertical: 8,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  totalLabel: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  totalAmount: {
    fontSize: 18,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#0C831F",
  },
  paymentMethodRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  paymentMethodText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.medium,
    color: "#5E6470",
  },
  doneBtn: {
    backgroundColor: "#1C1C1C",
    paddingVertical: 13,
    borderRadius: 20,
    alignItems: "center",
  },
  doneBtnText: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
