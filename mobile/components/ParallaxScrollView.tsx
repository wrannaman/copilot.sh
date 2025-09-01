import type { PropsWithChildren, ReactElement } from 'react';
import { StyleSheet, ScrollView, type RefreshControlProps } from 'react-native';

import { ThemedView } from '@/components/ThemedView';
import { useBottomTabOverflow } from '@/components/ui/TabBarBackground';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = PropsWithChildren<{
  headerImage?: ReactElement;
  headerBackgroundColor?: { dark: string; light: string };
  refreshControl?: ReactElement<RefreshControlProps>;
  contentPadding?: number;
  includeTopInset?: boolean;
}>;

export default function ParallaxScrollView({
  children,
  headerImage,
  headerBackgroundColor,
  refreshControl,
  contentPadding,
  includeTopInset = true,
}: Props) {
  const bottom = useBottomTabOverflow();
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        scrollEventThrottle={16}
        scrollIndicatorInsets={{ top: insets.top, bottom }}
        contentContainerStyle={{ paddingTop: includeTopInset ? insets.top : 0, paddingBottom: bottom }}
        refreshControl={refreshControl}>
        {headerImage ? (
          <ThemedView style={styles.header}>
            {headerImage}
          </ThemedView>
        ) : null}
        <ThemedView style={[styles.content, contentPadding !== undefined ? { padding: contentPadding } : null]}>
          {children}
        </ThemedView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    padding: 32,
    gap: 16,
    overflow: 'hidden',
  },
});
