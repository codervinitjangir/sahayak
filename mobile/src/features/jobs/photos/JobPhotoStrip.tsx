// ADR-055: the owner's photos of the problem, for the owner and for the partner
// who took the job. Each image is a 60-second signed link fetched on demand.
import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image, Modal, Pressable, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Colors, Radius, Spacing, Typography } from "../../../constants/theme";
import { safeguardsApi, type JobPhoto } from "../../../services/api/safeguards";

function Thumb({ jobId, photo, onOpen }: { jobId: string; photo: JobPhoto; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    safeguardsApi
      .photoUrl(jobId, photo.id)
      .then((r) => live && setUrl(r.url))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [jobId, photo.id]);
  return (
    <Pressable
      // The thumbnail's link is only good for 60 s, so the full view asks again.
      onPress={() =>
        void safeguardsApi
          .photoUrl(jobId, photo.id)
          .then((r) => onOpen(r.url))
          .catch(() => url && onOpen(url))
      }
      disabled={!url}
      accessibilityRole="imagebutton"
      accessibilityLabel="Open photo of the problem"
      style={styles.thumb}
    >
      {url ? (
        <Image source={{ uri: url }} style={styles.img} />
      ) : failed ? (
        <Ionicons name="image-outline" size={22} color={Colors.textMuted} />
      ) : (
        <ActivityIndicator color={Colors.brand700} />
      )}
    </Pressable>
  );
}

export default function JobPhotoStrip({ jobId, photos, title }: { jobId: string; photos: JobPhoto[]; title: string }) {
  const issue = photos.filter((p) => p.stage === "issue");
  const [open, setOpen] = useState<string | null>(null);
  if (issue.length === 0) return null;
  return (
    <View style={{ marginTop: Spacing.md }}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.row}>
        {issue.map((p) => (
          <Thumb key={p.id} jobId={jobId} photo={p} onOpen={setOpen} />
        ))}
      </View>
      <Modal visible={open != null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.viewer} onPress={() => setOpen(null)} accessibilityRole="button" accessibilityLabel="Close photo">
          {open ? <Image source={{ uri: open }} style={styles.full} resizeMode="contain" /> : null}
          <View style={styles.close}>
            <Ionicons name="close" size={26} color="#fff" />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/** The owner's own photos on a request, read from the shared safeguards query. */
export function OwnerIssuePhotos({ jobId }: { jobId: string }) {
  const q = useQuery({ queryKey: ["safeguards", jobId], queryFn: () => safeguardsApi.get(jobId), refetchInterval: 10000 });
  return <JobPhotoStrip jobId={jobId} photos={q.data?.photos ?? []} title="Your photos" />;
}

const styles = StyleSheet.create({
  title: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary, marginBottom: Spacing.sm },
  row: { flexDirection: "row", gap: Spacing.sm },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  img: { width: "100%", height: "100%" },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  full: { width: "100%", height: "80%" },
  close: { position: "absolute", top: 48, right: 20, width: 48, height: 48, alignItems: "center", justifyContent: "center" },
});
