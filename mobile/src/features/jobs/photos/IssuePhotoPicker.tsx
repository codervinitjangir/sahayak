// ADR-055: up to three photos of the problem, taken or chosen before sending.
// The photos stay on the phone until the request exists, then upload.
import React from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { Colors, Radius, Spacing, Typography } from "../../../constants/theme";
import { MAX_ISSUE_PHOTOS, type PickedPhoto } from "./issuePhotos";

export default function IssuePhotoPicker({
  photos,
  onChange,
  max = MAX_ISSUE_PHOTOS,
  busy = false,
}: {
  photos: PickedPhoto[];
  onChange: (next: PickedPhoto[]) => void;
  max?: number;
  busy?: boolean;
}) {
  const pick = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", fromCamera ? "Allow the camera to take a photo." : "Allow photo access to choose a photo.");
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.5, allowsEditing: false };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    onChange([...photos, { uri: a.uri, mimeType: a.mimeType }].slice(0, max));
  };

  const add = () =>
    Alert.alert("Add a photo", "Show the mechanic what is wrong.", [
      { text: "Take photo", onPress: () => void pick(true) },
      { text: "Choose from gallery", onPress: () => void pick(false) },
      { text: "Cancel", style: "cancel" },
    ]);

  return (
    <View style={styles.row}>
      {photos.map((p, i) => (
        <View key={p.uri} style={styles.thumbWrap}>
          <Image source={{ uri: p.uri }} style={styles.thumb} accessibilityLabel={`Photo ${i + 1}`} />
          {!busy ? (
            <Pressable
              onPress={() => onChange(photos.filter((x) => x.uri !== p.uri))}
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${i + 1}`}
              hitSlop={10}
              style={styles.remove}
            >
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      ))}
      {photos.length < max && !busy ? (
        <Pressable onPress={add} accessibilityRole="button" accessibilityLabel="Add a photo of the problem" style={styles.add}>
          <Ionicons name="camera-outline" size={24} color={Colors.brand700} />
          <Text style={styles.addText}>{photos.length === 0 ? "Add photo" : "Add"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const SIZE = 76;
const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  thumbWrap: { width: SIZE, height: SIZE },
  thumb: { width: SIZE, height: SIZE, borderRadius: Radius.md, backgroundColor: Colors.surface },
  remove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(15,23,42,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  add: {
    width: SIZE,
    height: SIZE,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.brand700,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: Colors.brand700Muted,
  },
  addText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700 },
});
