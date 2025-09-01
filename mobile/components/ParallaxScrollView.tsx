import type { PropsWithChildren, ReactElement } from 'react';
import { StyleSheet, ScrollView, View, type RefreshControlProps } from 'react-native';

// import { ThemedView } from '@/components/ThemedView'; // DISABLED FOR TESTING
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
    <View style={styles.container}>
      <ScrollView
        scrollEventThrottle={16}
        scrollIndicatorInsets={{ top: insets.top, bottom }}
        contentContainerStyle={{ paddingTop: includeTopInset ? insets.top : 0, paddingBottom: bottom }}
        refreshControl={refreshControl}>
        {headerImage ? (
          <View style={styles.header}>
            {headerImage}
          </View>
        ) : null}
        <View style={[styles.content, contentPadding !== undefined ? { padding: contentPadding } : null]}>
          {children}
        </View>
      </ScrollView>
    </View>
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
