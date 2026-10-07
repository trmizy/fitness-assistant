import { useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";

import { apiBaseUrl } from "../../config/serverUrl";
import { resolveMediaUri } from "../../utils/mediaUrl";

/**
 * Circular avatar with an initials fallback — the reference's `Avatar`, including its font size
 * rule (`size * 0.36`) so initials keep the same optical weight at every diameter.
 *
 * `expo-image` rather than RN's `Image`: avatars are the most-repeated remote image in the app
 * (every list row, every chat bubble), and it brings disk+memory caching and a fade-in that RN's
 * own component does not have.
 *
 * `uri` may be a path on the gateway rather than a full URL (see resolveMediaUri). A picture that
 * fails to load falls back to the initials — an empty circle tells nobody whose row this is.
 */
export function Avatar({
  uri,
  name,
  size = 44,
  className = "",
}: {
  uri?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const source = resolveMediaUri(uri, apiBaseUrl());
  // Remembers WHICH picture failed, so a new one gets its own chance without an effect to reset.
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = !!source && failedSource === source;

  return (
    <View
      className={`shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel ${className}`}
      style={{ width: size, height: size }}
      accessibilityLabel={name}
    >
      {source && !failed ? (
        <Image
          source={{ uri: source }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
          onError={() => setFailedSource(source)}
        />
      ) : (
        <Text
          className="font-display text-primary"
          style={{ fontSize: size * 0.36 }}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}
