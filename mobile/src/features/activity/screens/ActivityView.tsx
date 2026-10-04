// ─── Sahayak — Orders Screen ──────────────────────────────────────────────────
// Features:
// 1. Active order live tracking card (partner ETA, OTP, call/track/cancel/share)
// 2. Job cancellation flow with reason picker
// 3. Star rating + contextual feedback tags modal on past orders
// 4. "Need help?" support & dispute flow with instant ticket generation
// 5. Download / share GST tax invoice
// 6. Order status filter tabs (All / Completed / Cancelled)
// 7. Clean empty state
// All follows AccountView grouped-card design language. No boxes.

import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Dimensions,
  Alert,
  Animated,
  Share,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "../../../constants/theme";
import { useJobStore } from "../../../store/jobStore";
import type { ServiceType, Job } from "../../../types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface ActivityViewProps {
  onLaunchService: (service: ServiceType, title?: string) => void;
  onOpenSos: () => void;
  onTrackActiveJob?: () => void;
  onGoToServices?: () => void;
  searchQuery?: string;
}

export interface ActivityItem {
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
  rating?: number;
  feedbackTags?: string[];
  otp: string;
  status: "completed" | "cancelled" | "upcoming";
  cancelReason?: string;
  invoiceId: string;
  basePrice: number;
  tax: number;
  iconName: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
}

const CANCEL_REASONS = [
  "Changed my mind",
  "Found help elsewhere",
  "ETA too long",
  "Booked by mistake",
  "Vehicle started working",
  "Other reason",
];

const DISPUTE_REASONS = [
  "Incorrect billing or extra charges demanded",
  "Service was incomplete or didn't resolve breakdown",
  "Technician behaviour was unprofessional",
  "Damage caused to vehicle during service",
  "Other issue or grievance",
];

const POSITIVE_FEEDBACK_TAGS = [
  "⚡ Arrived fast",
  "🤝 Polite technician",
  "🔧 Fixed issue perfectly",
  "💰 Fair & transparent",
  "🛡️ Safe vehicle handling",
  "📱 Clear communication",
];

const NEGATIVE_FEEDBACK_TAGS = [
  "⏱️ Late arrival",
  "⚠️ Incomplete repair",
  "🗣️ Unprofessional behavior",
  "💵 Extra charges demanded",
  "🚗 Wrong equipment used",
  "📞 Did not pick up calls",
];

const INITIAL_ACTIVITIES: ActivityItem[] = [
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
    feedbackTags: ["⚡ Arrived fast", "🔧 Fixed issue perfectly"],
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
    feedbackTags: ["🛡️ Safe vehicle handling"],
    otp: "9354",
    status: "completed",
    invoiceId: "SHK-2026-72409",
    basePrice: 480,
    tax: 69,
    iconName: "car-sport",
    iconBg: "#F0F2F5",
    iconColor: "#1C1C1C",
  },
  {
    id: "act_04",
    serviceType: "fuel",
    serviceTitle: "Emergency 5L Petrol Delivery",
    vehicle: "Maruti Suzuki Swift",
    plate: "KA 05 MN 1234",
    date: "04 Sep 2026, 9:20 PM",
    location: "Koramangala 80 Feet Road, 4th Block",
    price: 149,
    paymentMethod: "Paytm UPI",
    partnerName: "Amit Verma",
    partnerVehicle: "Hero Splendor #09",
    otp: "3312",
    status: "cancelled",
    cancelReason: "Found fuel station 200m ahead",
    invoiceId: "SHK-2026-61092",
    basePrice: 149,
    tax: 0,
    iconName: "water",
    iconBg: "#F0F2F5",
    iconColor: "#1C1C1C",
  },
];

// ─── STATUS LABEL MAPPING ─────────────────────────────────────────────────────
function getJobStatusLabel(status: Job["status"]): { text: string; color: string; bg: string } {
  switch (status) {
    case "searching": return { text: "Searching for technicians...", color: "#C2850C", bg: "#FEF6D8" };
    case "matched": return { text: "Technician assigned!", color: "#0C831F", bg: "#E6F4EA" };
    case "en_route": return { text: "Technician on the way", color: "#0C831F", bg: "#E6F4EA" };
    case "arrived": return { text: "Technician has arrived", color: "#0C831F", bg: "#E6F4EA" };
    case "in_progress": return { text: "Service in progress", color: "#1C1C1C", bg: "#F0F2F5" };
    default: return { text: "Processing request", color: "#64748B", bg: "#F0F2F5" };
  }
}

export default function ActivityView({
  onLaunchService,
  onOpenSos,
  onTrackActiveJob,
  onGoToServices,
  searchQuery = "",
}: ActivityViewProps) {
  const [activities, setActivities] = useState<ActivityItem[]>(INITIAL_ACTIVITIES);
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "cancelled">("all");
  const [receiptItem, setReceiptItem] = useState<ActivityItem | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedCancelReason, setSelectedCancelReason] = useState<string | null>(null);

  // Rating Modal state
  const [ratingItem, setRatingItem] = useState<ActivityItem | null>(null);
  const [selectedRating, setSelectedRating] = useState<number>(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [ratingComment, setRatingComment] = useState("");

  // Dispute / Help Modal state
  const [supportItem, setSupportItem] = useState<ActivityItem | null>(null);
  const [selectedDisputeReason, setSelectedDisputeReason] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState("");

  const { activeJob, startCode, setActiveJob } = useJobStore();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for active order
  useEffect(() => {
    if (activeJob && (activeJob.status === "searching" || activeJob.status === "en_route")) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [activeJob?.status]);

  const query = searchQuery.trim().toLowerCase();

  const filteredActivities = activities.filter((item) => {
    // Status filter
    if (statusFilter !== "all" && item.status !== statusFilter) return false;

    // Search query
    if (!query) return true;
    return (
      item.serviceTitle.toLowerCase().includes(query) ||
      item.vehicle.toLowerCase().includes(query) ||
      item.plate.toLowerCase().includes(query) ||
      item.invoiceId.toLowerCase().includes(query) ||
      item.location.toLowerCase().includes(query)
    );
  });

  const completedCount = activities.filter((a) => a.status === "completed").length;
  const cancelledCount = activities.filter((a) => a.status === "cancelled").length;

  const handleCancelJob = () => {
    if (!selectedCancelReason) {
      Alert.alert("Select a reason", "Please select a reason for cancellation.");
      return;
    }
    Alert.alert(
      "Cancel this request?",
      `Reason: ${selectedCancelReason}\n\nNo cancellation fee will be charged since the technician hasn't started.`,
      [
        { text: "Go Back", style: "cancel" },
        {
          text: "Yes, Cancel",
          style: "destructive",
          onPress: () => {
            setActiveJob(null);
            setShowCancelModal(false);
            setSelectedCancelReason(null);
            Alert.alert("Request Cancelled", "Your service request has been cancelled.");
          },
        },
      ]
    );
  };

  const handleShareLocation = () => {
    const address = activeJob?.pickupLocation?.address || "my current breakdown location";
    const message = `🚨 I'm stranded at ${address}. My Sahayak technician is arriving soon. Track me live: https://sahayak.app/track/${activeJob?.id || "demo"}`;
    Share.share({ message }).catch(() => {});
  };

  const handleCallPartner = () => {
    Alert.alert(
      "Call Technician",
      "Connecting you to your assigned technician via masked secure number...",
      [{ text: "OK" }]
    );
  };

  const handleShareInvoice = (item: ActivityItem) => {
    const invoiceSummary = `🧾 SAHAYAK TAX INVOICE\nInvoice ID: ${item.invoiceId}\nService: ${item.serviceTitle}\nVehicle: ${item.vehicle} (${item.plate})\nDate: ${item.date}\nAmount: ₹${item.price}\nStatus: ${item.status.toUpperCase()}\nPayment: ${item.paymentMethod}\nGSTIN: 29AABCS1429B1Z8\nVerify: https://sahayak.app/invoice/${item.invoiceId}`;
    Share.share({
      title: `Invoice ${item.invoiceId}`,
      message: invoiceSummary,
    }).catch(() => {});
  };

  const handleOpenRating = (item: ActivityItem) => {
    setRatingItem(item);
    setSelectedRating(item.rating || 5);
    setSelectedTags(item.feedbackTags || []);
    setRatingComment("");
  };

  const toggleFeedbackTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags((prev) => prev.filter((t) => t !== tag));
    } else {
      setSelectedTags((prev) => [...prev, tag]);
    }
  };

  const handleSubmitRating = () => {
    if (!ratingItem) return;
    setActivities((prev) =>
      prev.map((a) =>
        a.id === ratingItem.id
          ? { ...a, rating: selectedRating, feedbackTags: selectedTags }
          : a
      )
    );
    const itemName = ratingItem.serviceTitle;
    setRatingItem(null);
    Alert.alert(
      "Thank you for your feedback! ⭐",
      `Your ${selectedRating}-star rating for ${itemName} has been submitted.`
    );
  };

  const handleOpenSupport = (item: ActivityItem) => {
    setSupportItem(item);
    setSelectedDisputeReason(null);
    setDisputeNote("");
  };

  const handleSubmitDispute = () => {
    if (!selectedDisputeReason) {
      Alert.alert("Select an issue", "Please choose what went wrong with this order.");
      return;
    }
    const ticketId = `SHK-${Math.floor(1000 + Math.random() * 9000)}`;
    const orderRef = supportItem?.invoiceId || "Recent Order";
    setSupportItem(null);
    Alert.alert(
      "Support Ticket Created 🛡️",
      `Ticket #${ticketId} created for ${orderRef}.\n\nOur safety and grievance team will contact you within 15 minutes to review and resolve this issue.`
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. ACTIVE ORDER LIVE TRACKING CARD (Phase 1 P0 Feature) ── */}
        {activeJob && activeJob.status !== "complete" && activeJob.status !== "cancelled" && activeJob.status !== "no_match_found" && (
          <View style={styles.sectionMargin}>
            <Text style={styles.sectionGroupTitle}>Active order</Text>
            <View style={styles.groupedCard}>
              {/* Status Row */}
              <View style={styles.activeStatusRow}>
                <Animated.View style={[styles.pulseDot, { opacity: pulseAnim, backgroundColor: getJobStatusLabel(activeJob.status).color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.activeStatusText, { color: getJobStatusLabel(activeJob.status).color }]}>
                    {getJobStatusLabel(activeJob.status).text}
                  </Text>
                  <Text style={styles.activeServiceName}>
                    {activeJob.serviceType.charAt(0).toUpperCase() + activeJob.serviceType.slice(1)} Service
                  </Text>
                </View>
                {activeJob.eta && (
                  <View style={styles.etaBadge}>
                    <Text style={styles.etaBadgeText}>{activeJob.eta} min</Text>
                  </View>
                )}
              </View>

              <View style={styles.divider} />

              {/* Partner Info (visible when matched/en_route/arrived/in_progress) */}
              {activeJob.status !== "searching" && activeJob.status !== "pending" && (
                <>
                  <View style={styles.partnerRow}>
                    <View style={styles.partnerAvatar}>
                      <Ionicons name="person" size={20} color="#1C1C1C" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.partnerName}>Ravi Kumar</Text>
                      <Text style={styles.partnerMeta}>4.9 ★ · Tata Ace (KA 03 XY 4567)</Text>
                    </View>
                    <TouchableOpacity style={styles.callBtn} onPress={handleCallPartner} activeOpacity={0.8}>
                      <Ionicons name="call" size={16} color="#0C831F" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.divider} />
                </>
              )}

              {/* 4-Digit OTP Display (visible when matched or en_route) */}
              {(activeJob.status === "matched" || activeJob.status === "en_route" || activeJob.status === "arrived") && (
                <>
                  <View style={styles.otpRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.otpLabel}>Service Start OTP</Text>
                      <Text style={styles.otpHint}>Share this code with your technician to begin</Text>
                    </View>
                    <View style={styles.otpBadge}>
                      <Text style={styles.otpCode}>{startCode}</Text>
                    </View>
                  </View>

                  <View style={styles.divider} />
                </>
              )}

              {/* Action Buttons Row */}
              <View style={styles.activeActionsRow}>
                {onTrackActiveJob && (
                  <>
                    <TouchableOpacity style={styles.activeActionBtn} onPress={onTrackActiveJob} activeOpacity={0.7}>
                      <Ionicons name="map-outline" size={16} color="#0C831F" />
                      <Text style={[styles.activeActionText, { color: "#0C831F" }]}>Track Map</Text>
                    </TouchableOpacity>
                    <View style={styles.actionDivider} />
                  </>
                )}

                <TouchableOpacity style={styles.activeActionBtn} onPress={handleShareLocation} activeOpacity={0.7}>
                  <Ionicons name="share-outline" size={16} color="#1C1C1C" />
                  <Text style={styles.activeActionText}>Share GPS</Text>
                </TouchableOpacity>

                <View style={styles.actionDivider} />

                <TouchableOpacity
                  style={styles.activeActionBtn}
                  onPress={() => setShowCancelModal(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close-circle-outline" size={16} color="#E23744" />
                  <Text style={[styles.activeActionText, { color: "#E23744" }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* ── 2. STATUS CARD (only when no active order) ── */}
        {(!activeJob || activeJob.status === "complete" || activeJob.status === "cancelled") && (
          <View style={styles.sectionMargin}>
            <View style={styles.groupedCard}>
              <View style={styles.statusRow}>
                <View style={styles.statusIconCircle}>
                  <Ionicons name="shield-checkmark" size={20} color="#0C831F" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.statusTitle}>All vehicles protected</Text>
                  <Text style={styles.statusSub}>No active breakdown · Fleet on standby 24/7</Text>
                </View>
                <TouchableOpacity
                  style={styles.sosQuickBtn}
                  onPress={() => onLaunchService("towing", "Emergency Towing")}
                  activeOpacity={0.8}
                >
                  <Text style={styles.sosQuickBtnText}>Help ▾</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* ── 3. ORDERS OVERVIEW (3-CARD ROW) ── */}
        <View style={styles.cardsRowWrapper}>
          <View style={styles.threeCardItem}>
            <View style={styles.threeCardIconBox}>
              <Ionicons name="checkmark-done-circle" size={24} color="#0C831F" />
            </View>
            <Text style={styles.threeCardTitle}>{completedCount} Orders</Text>
            <Text style={styles.threeCardSub}>Completed</Text>
          </View>

          <View style={styles.threeCardItem}>
            <View style={styles.threeCardIconBox}>
              <Ionicons name="wallet-outline" size={24} color="#1C1C1C" />
            </View>
            <Text style={styles.threeCardTitle}>₹450 Saved</Text>
            <Text style={styles.threeCardSub}>RSA Pass</Text>
          </View>

          <TouchableOpacity
            style={styles.threeCardItem}
            onPress={() => {
              Alert.alert(
                "24/7 Roadside Emergency Desk 🇮🇳",
                "Toll-Free Helpline: 1800-SAHAYAK (1800-724-2925)\nWhatsApp Help: +91 80 4921 5500\n\nVerified technicians & towing fleet on standby across India."
              );
            }}
            activeOpacity={0.85}
          >
            <View style={styles.threeCardIconBox}>
              <Ionicons name="headset-outline" size={24} color="#C2850C" />
            </View>
            <Text style={styles.threeCardTitle}>24/7 Desk</Text>
            <Text style={styles.threeCardSub}>Call / Chat</Text>
          </TouchableOpacity>
        </View>

        {/* ── 4. STATUS FILTER TABS ── */}
        <View style={styles.filterTabsRow}>
          <TouchableOpacity
            style={[styles.filterTabPill, statusFilter === "all" && styles.filterTabPillActive]}
            onPress={() => setStatusFilter("all")}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterTabText, statusFilter === "all" && styles.filterTabTextActive]}>
              All ({activities.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterTabPill, statusFilter === "completed" && styles.filterTabPillActive]}
            onPress={() => setStatusFilter("completed")}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterTabText, statusFilter === "completed" && styles.filterTabTextActive]}>
              Completed ({completedCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterTabPill, statusFilter === "cancelled" && styles.filterTabPillActive]}
            onPress={() => setStatusFilter("cancelled")}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterTabText, statusFilter === "cancelled" && styles.filterTabTextActive]}>
              Cancelled ({cancelledCount})
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── 5. PAST ORDERS LIST ── */}
        <View style={styles.sectionMargin}>
          <Text style={styles.sectionGroupTitle}>Past orders & invoices</Text>

          {filteredActivities.length === 0 ? (
            <View style={styles.groupedCard}>
              <View style={styles.emptyStateBox}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="receipt-outline" size={32} color="#94A3B8" />
                </View>
                <Text style={styles.emptyStateTitle}>No orders found</Text>
                <Text style={styles.emptyStateSub}>
                  {query
                    ? `No orders matching "${query}"`
                    : "No orders in this category yet."}
                </Text>
                {onGoToServices && (
                  <TouchableOpacity
                    style={styles.emptyStateBtn}
                    onPress={onGoToServices}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.emptyStateBtnText}>Explore Services</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : (
            <View style={styles.groupedCard}>
              {filteredActivities.map((item, idx) => (
                <View key={item.id}>
                  <TouchableOpacity
                    style={styles.rescueRow}
                    onPress={() => setReceiptItem(item)}
                    activeOpacity={0.7}
                  >
                    {/* Service Icon */}
                    <View style={[styles.serviceIconCircle, { backgroundColor: item.iconBg }]}>
                      <Ionicons name={item.iconName} size={20} color={item.iconColor} />
                    </View>

                    {/* Main Details */}
                    <View style={styles.rescueInfoCol}>
                      <View style={styles.rescueTitleRow}>
                        <Text style={styles.rescueTitle}>{item.serviceTitle}</Text>
                        <Text style={styles.priceAmount}>₹{item.price}</Text>
                      </View>

                      <Text style={styles.vehiclePlateText}>
                        {item.vehicle} ({item.plate})
                      </Text>

                      <Text style={styles.locationText} numberOfLines={1}>
                        {item.location} · {item.date}
                      </Text>

                      {/* Status / Rating Row */}
                      <View style={styles.metaRow}>
                        <View style={[styles.statusPill, item.status === "cancelled" && { backgroundColor: "#FDECEA" }]}>
                          <Ionicons
                            name={item.status === "completed" ? "checkmark-circle" : "close-circle"}
                            size={11}
                            color={item.status === "completed" ? "#0C831F" : "#E23744"}
                          />
                          <Text style={[styles.statusPillText, item.status === "cancelled" && { color: "#E23744" }]}>
                            {item.status === "completed" ? "Completed" : "Cancelled"}
                          </Text>
                        </View>

                        {item.status === "completed" && (
                          <>
                            <Text style={styles.bulletDot}>•</Text>
                            {item.rating ? (
                              <TouchableOpacity
                                style={styles.ratingBadgeRow}
                                onPress={() => handleOpenRating(item)}
                              >
                                <Ionicons name="star" size={11} color="#C2850C" />
                                <Text style={styles.ratingBadgeText}>{item.rating.toFixed(1)} ★</Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                style={styles.ratePromptBtn}
                                onPress={() => handleOpenRating(item)}
                              >
                                <Text style={styles.ratePromptText}>⭐ Rate Order</Text>
                              </TouchableOpacity>
                            )}
                          </>
                        )}

                        <Text style={styles.bulletDot}>•</Text>
                        <Text style={styles.invoiceLink}>Tax invoice</Text>
                      </View>
                    </View>

                    <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
                  </TouchableOpacity>

                  {idx < filteredActivities.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ── 6. EMERGENCY CONTACTS & HELPLINES ── */}
        <View style={styles.sectionMargin}>
          <Text style={styles.sectionGroupTitle}>Emergency contacts & helplines</Text>
          <View style={styles.groupedCard}>
            <TouchableOpacity
              style={styles.helplineRow}
              onPress={() => {
                Alert.alert("Emergency 112", "Calling National Emergency Service...");
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.serviceIconCircle, { backgroundColor: "#FDECEA" }]}>
                <Ionicons name="call" size={18} color="#E23744" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.helplineTitle}>National Emergency Helpline</Text>
                <Text style={styles.helplineSub}>Police, Ambulance, Fire (Dial 112)</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.helplineRow}
              onPress={() => {
                Alert.alert(
                  "Sahayak Emergency Helpline",
                  "24/7 Nationwide Breakdown Response\nToll-Free: 1800-SAHAYAK (1800-724-2925)"
                );
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.serviceIconCircle, { backgroundColor: "#FEF6D8" }]}>
                <Ionicons name="car" size={18} color="#C2850C" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.helplineTitle}>Sahayak Roadside Emergency Dispatch</Text>
                <Text style={styles.helplineSub}>Direct tow & mechanical fleet (1800-SAHAYAK)</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.helplineRow}
              onPress={() => {
                Alert.alert(
                  "Emergency Contacts Alert",
                  "When breakdown occurs, an SMS tracking link is automatically dispatched to:\n\n• Pooja Sharma: +91 98765 00001\n• Vikas Sharma: +91 98765 00002"
                );
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.serviceIconCircle, { backgroundColor: "#E6F4EA" }]}>
                <Ionicons name="people" size={18} color="#0C831F" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.helplineTitle}>Auto-share live GPS on breakdown</Text>
                <Text style={styles.helplineSub}>Emergency contacts receive live SMS tracking</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* ── CANCELLATION REASON MODAL (Phase 1 P0 Feature) ── */}
      <Modal
        visible={showCancelModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCancelModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.cancelModalCard}>
            <View style={styles.cancelModalHeader}>
              <Text style={styles.cancelModalTitle}>Why are you cancelling?</Text>
              <TouchableOpacity
                onPress={() => { setShowCancelModal(false); setSelectedCancelReason(null); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color="#1C1C1C" />
              </TouchableOpacity>
            </View>

            <View style={styles.cancelReasonList}>
              {CANCEL_REASONS.map((reason, idx) => (
                <View key={reason}>
                  <TouchableOpacity
                    style={styles.cancelReasonRow}
                    onPress={() => setSelectedCancelReason(reason)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={selectedCancelReason === reason ? "radio-button-on" : "radio-button-off"}
                      size={20}
                      color={selectedCancelReason === reason ? "#1C1C1C" : "#94A3B8"}
                    />
                    <Text style={[styles.cancelReasonText, selectedCancelReason === reason && { fontWeight: "700", color: "#1C1C1C" }]}>
                      {reason}
                    </Text>
                  </TouchableOpacity>
                  {idx < CANCEL_REASONS.length - 1 && <View style={styles.cancelDivider} />}
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.cancelConfirmBtn, !selectedCancelReason && { opacity: 0.4 }]}
              onPress={handleCancelJob}
              activeOpacity={0.85}
              disabled={!selectedCancelReason}
            >
              <Text style={styles.cancelConfirmBtnText}>Cancel Request</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── GST RECEIPT MODAL ── */}
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
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 440 }}>
                {/* Invoice Meta */}
                <View style={styles.invoiceMetaCard}>
                  <View style={styles.invoiceMetaRow}>
                    <Text style={styles.metaLabel}>Invoice No:</Text>
                    <Text style={styles.metaVal}>{receiptItem.invoiceId}</Text>
                  </View>
                  <View style={styles.invoiceMetaRow}>
                    <Text style={styles.metaLabel}>Date & Time:</Text>
                    <Text style={styles.metaVal}>{receiptItem.date}</Text>
                  </View>
                  <View style={styles.invoiceMetaRow}>
                    <Text style={styles.metaLabel}>Registered Vehicle:</Text>
                    <Text style={styles.metaVal}>{receiptItem.plate}</Text>
                  </View>
                  <View style={styles.invoiceMetaRow}>
                    <Text style={styles.metaLabel}>Assigned Partner:</Text>
                    <Text style={styles.metaVal}>{receiptItem.partnerName}</Text>
                  </View>
                  {receiptItem.status === "cancelled" && receiptItem.cancelReason && (
                    <View style={styles.invoiceMetaRow}>
                      <Text style={[styles.metaLabel, { color: "#E23744" }]}>Cancellation:</Text>
                      <Text style={[styles.metaVal, { color: "#E23744" }]}>{receiptItem.cancelReason}</Text>
                    </View>
                  )}
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

                {/* Secondary Action Buttons */}
                <View style={styles.invoiceActionsRow}>
                  <TouchableOpacity
                    style={styles.invoiceActionBtn}
                    onPress={() => handleShareInvoice(receiptItem)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="share-outline" size={15} color="#1C1C1C" />
                    <Text style={styles.invoiceActionBtnText}>Share / Download</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.invoiceActionBtn}
                    onPress={() => {
                      const item = receiptItem;
                      setReceiptItem(null);
                      handleOpenSupport(item);
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="help-circle-outline" size={15} color="#E23744" />
                    <Text style={[styles.invoiceActionBtnText, { color: "#E23744" }]}>Need Help?</Text>
                  </TouchableOpacity>
                </View>

                {/* Book Again Action */}
                <TouchableOpacity
                  style={styles.rebookActionBtn}
                  onPress={() => {
                    const item = receiptItem;
                    setReceiptItem(null);
                    onLaunchService(item.serviceType, item.serviceTitle);
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="repeat" size={16} color="#1C1C1C" />
                  <Text style={styles.rebookActionBtnText}>Request This Service Again</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => setReceiptItem(null)}
              activeOpacity={0.88}
            >
              <Text style={styles.doneBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── STAR RATING & FEEDBACK TAGS MODAL ── */}
      <Modal
        visible={!!ratingItem}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setRatingItem(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.ratingModalCard}>
            <View style={styles.cancelModalHeader}>
              <View>
                <Text style={styles.ratingModalTitle}>Rate Your Experience</Text>
                <Text style={styles.ratingModalSub}>{ratingItem?.serviceTitle} · {ratingItem?.partnerName}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setRatingItem(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color="#1C1C1C" />
              </TouchableOpacity>
            </View>

            {/* Interactive Stars */}
            <View style={styles.starsWrapper}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => setSelectedRating(star)}
                  style={styles.starTouch}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={star <= selectedRating ? "star" : "star-outline"}
                    size={36}
                    color={star <= selectedRating ? "#F59E0B" : "#CBD5E1"}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.ratingFeedbackHint}>
              {selectedRating >= 4 ? "What made it great?" : "What could be improved?"}
            </Text>

            {/* Contextual Feedback Tags */}
            <View style={styles.feedbackTagsWrap}>
              {(selectedRating >= 4 ? POSITIVE_FEEDBACK_TAGS : NEGATIVE_FEEDBACK_TAGS).map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.feedbackTagChip, isSelected && styles.feedbackTagChipActive]}
                    onPress={() => toggleFeedbackTag(tag)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.feedbackTagText, isSelected && styles.feedbackTagTextActive]}>
                      {tag}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Optional Comment Input */}
            <TextInput
              style={styles.commentInput}
              placeholder="Add an optional comment for technician..."
              placeholderTextColor="#94A3B8"
              value={ratingComment}
              onChangeText={setRatingComment}
              maxLength={200}
            />

            <TouchableOpacity
              style={styles.submitRatingBtn}
              onPress={handleSubmitRating}
              activeOpacity={0.85}
            >
              <Text style={styles.submitRatingBtnText}>Submit Feedback</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── ORDER DISPUTE / SUPPORT MODAL ── */}
      <Modal
        visible={!!supportItem}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setSupportItem(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.supportModalCard}>
            <View style={styles.cancelModalHeader}>
              <View>
                <Text style={styles.ratingModalTitle}>Report an Issue</Text>
                <Text style={styles.ratingModalSub}>{supportItem?.serviceTitle} · {supportItem?.invoiceId}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setSupportItem(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color="#1C1C1C" />
              </TouchableOpacity>
            </View>

            <Text style={styles.disputeSelectTitle}>What went wrong?</Text>

            <View style={styles.cancelReasonList}>
              {DISPUTE_REASONS.map((reason, idx) => (
                <View key={reason}>
                  <TouchableOpacity
                    style={styles.cancelReasonRow}
                    onPress={() => setSelectedDisputeReason(reason)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={selectedDisputeReason === reason ? "radio-button-on" : "radio-button-off"}
                      size={18}
                      color={selectedDisputeReason === reason ? "#E23744" : "#94A3B8"}
                    />
                    <Text style={[styles.cancelReasonText, selectedDisputeReason === reason && { fontWeight: "700", color: "#1C1C1C" }]}>
                      {reason}
                    </Text>
                  </TouchableOpacity>
                  {idx < DISPUTE_REASONS.length - 1 && <View style={styles.cancelDivider} />}
                </View>
              ))}
            </View>

            <TextInput
              style={[styles.commentInput, { marginTop: 10, minHeight: 60 }]}
              placeholder="Describe what happened in detail (optional)..."
              placeholderTextColor="#94A3B8"
              value={disputeNote}
              onChangeText={setDisputeNote}
              multiline
              maxLength={300}
            />

            <View style={styles.disputeGuaranteeNote}>
              <Ionicons name="shield-checkmark" size={16} color="#0C831F" />
              <Text style={styles.disputeGuaranteeText}>
                100% Sahayak Protection: 15-minute response callback guarantee.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.cancelConfirmBtn, !selectedDisputeReason && { opacity: 0.4 }]}
              onPress={handleSubmitDispute}
              activeOpacity={0.85}
              disabled={!selectedDisputeReason}
            >
              <Text style={styles.cancelConfirmBtnText}>Submit Support Request</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── STYLES (AccountView Grouped-Card Standard — No Boxes) ─────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F6F8",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 110,
    paddingTop: 12,
  },
  sectionMargin: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  sectionGroupTitle: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "700",
    color: "#5E6470",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 4,
  },
  groupedCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#EAECEF",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#EAECEF",
    marginLeft: 60,
  },

  // Filter Tabs
  filterTabsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    marginBottom: 14,
    gap: 8,
  },
  filterTabPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#E2E8F0",
  },
  filterTabPillActive: {
    backgroundColor: "#1C1C1C",
  },
  filterTabText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "600",
    color: "#475569",
  },
  filterTabTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  // Active Order Live Card
  activeStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  pulseDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  activeStatusText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
  },
  activeServiceName: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    marginTop: 2,
  },
  etaBadge: {
    backgroundColor: "#E6F4EA",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  etaBadgeText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#0C831F",
  },
  partnerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  partnerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F0F2F5",
    alignItems: "center",
    justifyContent: "center",
  },
  partnerName: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  partnerMeta: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 2,
  },
  callBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E6F4EA",
    alignItems: "center",
    justifyContent: "center",
  },
  otpRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: "#FEF6D8",
  },
  otpLabel: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#8F6405",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  otpHint: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 2,
  },
  otpBadge: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#F8CB46",
  },
  otpCode: {
    fontSize: 18,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    letterSpacing: 3,
  },
  activeActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#EAECEF",
  },
  activeActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    gap: 6,
  },
  actionDivider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: "#EAECEF",
  },
  activeActionText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#1C1C1C",
  },

  // Protection Status
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  statusIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E6F4EA",
    alignItems: "center",
    justifyContent: "center",
  },
  statusTitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  statusSub: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 2,
  },
  sosQuickBtn: {
    backgroundColor: "#1C1C1C",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  sosQuickBtnText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // 3-Card Metrics Row
  cardsRowWrapper: {
    flexDirection: "row",
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 10,
  },
  threeCardItem: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#EAECEF",
  },
  threeCardIconBox: {
    marginBottom: 6,
  },
  threeCardTitle: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    textAlign: "center",
  },
  threeCardSub: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 2,
    textAlign: "center",
  },

  // Past Orders List
  rescueRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  serviceIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rescueInfoCol: {
    flex: 1,
  },
  rescueTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rescueTitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "700",
    color: "#1C1C1C",
    flex: 1,
  },
  priceAmount: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    marginLeft: 8,
  },
  vehiclePlateText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.medium,
    color: "#5E6470",
    marginTop: 2,
  },
  locationText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#8C93A0",
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    flexWrap: "wrap",
    gap: 6,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E6F4EA",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  statusPillText: {
    fontSize: 10.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#0C831F",
  },
  bulletDot: {
    fontSize: 10,
    color: "#8C93A0",
  },
  invoiceLink: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.medium,
    color: "#0C831F",
  },
  ratingBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#FEF6D8",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  ratingBadgeText: {
    fontSize: 10.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#8F6405",
  },
  ratePromptBtn: {
    backgroundColor: "#FEF6D8",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  ratePromptText: {
    fontSize: 10.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#8F6405",
  },

  // Empty state
  emptyStateBox: {
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  emptyStateSub: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    textAlign: "center",
    marginTop: 4,
    maxWidth: 260,
  },
  emptyStateBtn: {
    marginTop: 16,
    backgroundColor: "#1C1C1C",
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
  },
  emptyStateBtnText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Helplines
  helplineRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  helplineTitle: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#1C1C1C",
  },
  helplineSub: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 2,
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  cancelModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  cancelModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  cancelModalTitle: {
    fontSize: 17,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  cancelReasonList: {
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 16,
  },
  cancelReasonRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  cancelReasonText: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#475569",
    flex: 1,
  },
  cancelDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E2E8F0",
    marginLeft: 46,
  },
  cancelConfirmBtn: {
    backgroundColor: "#E23744",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelConfirmBtnText: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Receipt Modal
  receiptModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  receiptHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  receiptBrand: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },
  receiptSub: {
    fontSize: 10.5,
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
    marginBottom: 14,
  },
  invoiceMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  metaLabel: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
  },
  metaVal: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "600",
    color: "#1C1C1C",
  },
  breakdownHeader: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "700",
    color: "#5E6470",
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
  invoiceActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  invoiceActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
    paddingVertical: 11,
    borderRadius: 12,
    gap: 6,
  },
  invoiceActionBtnText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#1C1C1C",
  },
  rebookActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF6D8",
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 12,
    gap: 6,
  },
  rebookActionBtnText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  doneBtn: {
    backgroundColor: "#1C1C1C",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  doneBtnText: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Rating Modal
  ratingModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  ratingModalTitle: {
    fontSize: 17,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  ratingModalSub: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 2,
  },
  starsWrapper: {
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
  },
  starTouch: {
    padding: 4,
  },
  ratingFeedbackHint: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 10,
  },
  feedbackTagsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  feedbackTagChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  feedbackTagChipActive: {
    backgroundColor: "#FEF6D8",
    borderColor: "#F8CB46",
  },
  feedbackTagText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.medium,
    color: "#475569",
  },
  feedbackTagTextActive: {
    color: "#8F6405",
    fontWeight: "700",
  },
  commentInput: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: Typography.fontFamily.regular,
    color: "#1C1C1C",
    marginBottom: 16,
  },
  submitRatingBtn: {
    backgroundColor: "#0C831F",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  submitRatingBtnText: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Support / Dispute Modal
  supportModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  disputeSelectTitle: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 10,
  },
  disputeGuaranteeNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#E6F4EA",
    padding: 10,
    borderRadius: 10,
    marginBottom: 16,
  },
  disputeGuaranteeText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.medium,
    color: "#0C831F",
    flex: 1,
  },
});
