import React from 'react'
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native'

type ButtonProps = {
  children: React.ReactNode
  onPress?: () => void
  disabled?: boolean
  style?: ViewStyle
  textColor?: string
}

export function Button({ children, onPress, disabled, style, textColor }: ButtonProps) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{}}
    >
      {({ pressed }) => {
        const overrideBg = (style as any)?.backgroundColor
        const backgroundColor = overrideBg ?? (disabled ? '#9ca3af' : pressed ? '#0b1220' : '#111827')
        return (
          <View style={[styles.base, { backgroundColor }, style]}>
            <Text style={[styles.label, textColor ? { color: textColor } : undefined]}>{children as any}</Text>
          </View>
        )
      }}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enabled: {},
  pressed: {},
  disabled: {},
  label: {
    color: 'white',
    fontWeight: '600',
  },
})


