import { View, type ViewProps } from 'react-native';

// TEMPORARILY DISABLED useThemeColor to test navigation context issue
// import { useThemeColor } from '@/hooks/useThemeColor';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
};

export function ThemedView({ style, lightColor, darkColor, ...otherProps }: ThemedViewProps) {
  // TESTING: Just use a normal View without theme colors
  // const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return <View style={style} {...otherProps} />;
}
