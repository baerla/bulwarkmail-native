import React from 'react';
import { Pressable, Text, StyleSheet, ViewStyle, ActivityIndicator } from 'react-native';
import { spacing, radius, typography, componentSizes, type ThemePalette } from '../theme/tokens';
import { useColors } from '../theme/colors';

type ButtonVariant = 'default' | 'ghost' | 'outline' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  /** Needed for an icon-only button; a text button reads its text. */
  accessibilityLabel?: string;
}

// Extra touch area so even the small sizes reach a 48 dp target.
const HIT_SLOP: Record<ButtonSize, number> = { sm: 6, md: 4, lg: 2, icon: 4 };

export default function Button({
  variant = 'default',
  size = 'md',
  children,
  onPress,
  disabled = false,
  loading = false,
  icon,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const isDisabled = disabled || loading;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        styles[`size_${size}` as const],
        styles[`bg_${variant}` as const],
        pressed && !isDisabled && styles[`pressed_${variant}` as const],
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={HIT_SLOP[size]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'default' ? c.primaryForeground : c.primary}
        />
      ) : (
        <>
          {icon}
          {typeof children === 'string' ? (
            <Text style={[styles.text, styles[`text_${variant}` as const], isDisabled && styles.textDisabled]}>
              {children}
            </Text>
          ) : (
            children
          )}
        </>
      )}
    </Pressable>
  );
}

function makeStyles(c: ThemePalette) {
  return StyleSheet.create({
    base: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      borderRadius: radius.md, gap: spacing.sm,
    },
    text: { ...typography.bodyMedium },
    disabled: { opacity: 0.5 },
    textDisabled: { opacity: 0.5 },

    size_sm:   { height: componentSizes.buttonSm, paddingHorizontal: spacing.md },
    size_md:   { height: componentSizes.buttonMd, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    size_lg:   { height: componentSizes.buttonLg, paddingHorizontal: spacing.xxxl },
    size_icon: { height: componentSizes.buttonMd, width: componentSizes.buttonMd, paddingHorizontal: 0 },

    bg_default:     { backgroundColor: c.primary, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 1, elevation: 1 },
    bg_ghost:       { backgroundColor: 'transparent' },
    bg_outline:     { backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
    bg_destructive: { backgroundColor: c.error, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 1, elevation: 1 },

    pressed_default:     { backgroundColor: c.primaryDark, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
    pressed_ghost:       { backgroundColor: c.accent },
    pressed_outline:     { backgroundColor: c.accent },
    pressed_destructive: { opacity: 0.9 },

    text_default:     { color: c.primaryForeground },
    text_ghost:       { color: c.text },
    text_outline:     { color: c.text },
    text_destructive: { color: c.errorForeground },
  });
}
