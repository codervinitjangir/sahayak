// Every rating behind the partner's average: who (first name + initial), which
// job, the stars and the comment. Read-only; data from GET /partners/me/reviews.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Colors, Spacing } from "../../../constants/theme";
import ScreenHero from "../../../components/ui/ScreenHero";
import Card from "../../../components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "../../../components/ui/kit";
import { partnerApi, type MobilePartnerReview } from "../../../services/api/partner";

function Stars({ value }: { value: number }) {
  return (
    <View style={styles.stars} accessible accessibilityLabel={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={n <= value ? "star" : "star-outline"} size={16} color={Colors.warning} />
      ))}
    </View>
  );
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function PartnerReviewsScreen() {
  const navigation = useNavigation();
  const [items, setItems] = useState<MobilePartnerReview[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await partnerApi.getReviews(100, 0);
      setItems(res.items ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const avg = items && items.length ? items.reduce((a, r) => a + r.rating, 0) / items.length : null;

  return (
    <View style={styles.root}>
      <ScreenHero
        title="Your reviews"
        greeting={avg !== null ? `${avg.toFixed(1)} ★` : undefined}
        subtitle={items ? `${items.length} ${items.length === 1 ? "review" : "reviews"} from customers` : undefined}
        left={{ icon: "chevron-back", onPress: () => navigation.goBack(), label: "Back" }}
      />
      {failed && !items ? (
        <ErrorState message="Could not load your reviews." onRetry={() => void load()} />
      ) : !items ? (
        <View style={styles.pad}>
          <Skeleton height={88} />
          <View style={{ height: 12 }} />
          <Skeleton height={88} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.job_id}
          contentContainerStyle={styles.pad}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <EmptyState icon="star-outline" title="No reviews yet" message="Customers can rate you after a completed job." />
          }
          renderItem={({ item }) => (
            <Card>
              <View style={styles.row}>
                <Text style={styles.name}>{item.owner_display_name}</Text>
                <Text style={styles.date}>{fmtDate(item.created_at)}</Text>
              </View>
              <Stars value={item.rating} />
              <Text style={styles.service}>{item.service_name}</Text>
              {item.comment ? <Text style={styles.comment}>“{item.comment}”</Text> : null}
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  pad: { padding: Spacing.screenHorizontal, paddingBottom: 40 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  name: { fontSize: 16, fontWeight: "700", color: Colors.textPrimary },
  date: { fontSize: 13, color: Colors.textSecondary },
  stars: { flexDirection: "row", gap: 2, marginBottom: 6 },
  service: { fontSize: 15, color: Colors.textSecondary },
  comment: { fontSize: 15, color: Colors.textPrimary, marginTop: 8, lineHeight: 21 },
});
