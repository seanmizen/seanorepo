// The controls of the screen. The look is the seanmizen.com look: one
// foreground color on one background color, a monospace font, and thin
// borders. A selected choice shows inverted.

import type { ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';

export type Theme = { fg: string; bg: string; muted: string };

const LIGHT: Theme = { fg: '#111', bg: '#eee', muted: '#666' };
const DARK: Theme = { fg: '#cecece', bg: '#333', muted: '#999' };

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}

export const FONT = Platform.select({
  ios: 'Courier New',
  android: 'monospace',
  default: '"Courier New", Courier, monospace',
});

export function Label({
  children,
  muted,
  size = 14,
}: {
  children: ReactNode;
  muted?: boolean;
  size?: number;
}) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: muted ? t.muted : t.fg,
        fontFamily: FONT,
        fontSize: size,
      }}
    >
      {children}
    </Text>
  );
}

/** One setting: its name above its control. */
export function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Label muted size={12}>
        {label.toUpperCase()}
      </Label>
      <View style={styles.rowBody}>{children}</View>
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  selected,
  grow,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  grow?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: t.fg,
          backgroundColor: selected ? t.fg : 'transparent',
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
        grow && styles.grow,
      ]}
    >
      <Text
        numberOfLines={1}
        style={{
          color: selected ? t.bg : t.fg,
          fontFamily: FONT,
          fontSize: 14,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A set of buttons. The button of the current value shows selected. */
export function Choice<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  column,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  column?: boolean;
}) {
  return (
    <View style={column ? styles.column : styles.choices}>
      {options.map((o) => (
        <Button
          key={String(o.value)}
          label={o.label}
          selected={o.value === value}
          disabled={disabled}
          onPress={() => onChange(o.value)}
          grow={!column}
        />
      ))}
    </View>
  );
}

/** A value with a "-" and a "+" button that step through a list of values. */
export function Stepper({
  values,
  value,
  format,
  onChange,
  disabled,
}: {
  values: number[];
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const i = values.indexOf(value);
  return (
    <View style={styles.stepper}>
      <Button
        label="-"
        disabled={disabled || i <= 0}
        onPress={() => onChange(values[i - 1])}
      />
      <View style={styles.stepperValue}>
        <Label size={16}>{format(value)}</Label>
      </View>
      <Button
        label="+"
        disabled={disabled || i >= values.length - 1}
        onPress={() => onChange(values[i + 1])}
      />
    </View>
  );
}

/** The round button that starts and stops the capture. */
export function Shutter({
  recording,
  disabled,
  onPress,
}: {
  recording: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? 'Stop the capture' : 'Start a capture'}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.shutter,
        { borderColor: t.fg, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      <View
        style={
          recording
            ? [styles.shutterStop, { backgroundColor: t.fg }]
            : [styles.shutterDot, { backgroundColor: t.fg }]
        }
      />
    </Pressable>
  );
}

/** A message over the black preview area, with an optional button. */
export function Notice({
  text,
  action,
}: {
  text: string;
  action?: { label: string; run: () => void };
}) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>{text}</Text>
      {action && (
        <Pressable
          accessibilityRole="button"
          onPress={action.run}
          style={styles.noticeButton}
        >
          <Text style={styles.noticeText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 10, gap: 6 },
  rowBody: { gap: 8 },
  button: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flexGrow: 1 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  column: { gap: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperValue: { flex: 1, alignItems: 'center' },
  shutter: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDot: { width: 52, height: 52, borderRadius: 26 },
  shutterStop: { width: 26, height: 26 },
  notice: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#000',
  },
  noticeText: {
    color: '#eee',
    fontFamily: FONT,
    fontSize: 14,
    textAlign: 'center',
  },
  noticeButton: {
    borderWidth: 1,
    borderColor: '#eee',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
