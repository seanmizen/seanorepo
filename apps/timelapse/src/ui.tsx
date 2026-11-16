// The controls of the screen. The look is the seanmizen.com look: one
// foreground color on one background color, a monospace font, and thin
// borders. A selected choice shows inverted.

import type { ReactNode } from 'react';
import { useState } from 'react';
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

/** One setting: a line with its name and its value, then its controls. */
export function Row({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Label muted size={11}>
          {label.toUpperCase()}
        </Label>
        <Label size={13}>{value}</Label>
      </View>
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
          fontSize: 13,
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
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.choices}>
      {options.map((o) => (
        <Button
          key={String(o.value)}
          label={o.label}
          selected={o.value === value}
          disabled={disabled}
          onPress={() => onChange(o.value)}
          grow
        />
      ))}
    </View>
  );
}

const THUMB = 20;
const STEP_KEYS: Record<string, number> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
};

/**
 * A slider over a list of values, on a log scale. A tap or a drag selects
 * the nearest value. It uses the plain touch responder of View, so it needs
 * no native module and works the same on the web and in Expo Go. The
 * children take no pointer events, so locationX is always across the track.
 * Screen readers change it with the increment and decrement actions, and
 * on the web the arrow keys step it.
 */
export function Slider({
  label,
  values,
  value,
  format,
  onChange,
  disabled,
}: {
  label: string;
  values: number[];
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const lo = Math.log(values[0]);
  const hi = Math.log(values[values.length - 1]);
  const at = (v: number) => (Math.log(v) - lo) / (hi - lo);
  const percent = (v: number) => `${at(v) * 100}%` as const;
  const pick = (x: number) => {
    if (!width) return;
    const want = Math.min(1, Math.max(0, x / width));
    let best = values[0];
    for (const v of values)
      if (Math.abs(at(v) - want) < Math.abs(at(best) - want)) best = v;
    if (best !== value) onChange(best);
  };
  const step = (by: number) => {
    const next = values[values.indexOf(value) + by];
    if (next !== undefined) onChange(next);
  };
  return (
    <View style={{ flex: 1, opacity: disabled ? 0.4 : 1 }}>
      <View
        accessible
        focusable={!disabled}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={values.length - 1}
        aria-valuenow={values.indexOf(value)}
        aria-valuetext={format(value)}
        aria-disabled={disabled}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) =>
          !disabled && step(e.nativeEvent.actionName === 'increment' ? 1 : -1)
        }
        // On the web, the arrow keys step the slider.
        onKeyDown={(e) => {
          const by = STEP_KEYS[e.nativeEvent.key];
          if (by === undefined || disabled) return;
          e.preventDefault();
          step(by);
        }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}
        style={styles.track}
      >
        <View style={[styles.rail, { backgroundColor: t.muted }]} />
        <View
          style={[
            styles.rail,
            { backgroundColor: t.fg, width: percent(value) },
          ]}
        />
        <View
          style={[
            styles.thumb,
            { left: percent(value), borderColor: t.fg, backgroundColor: t.bg },
          ]}
        />
      </View>
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
  row: { paddingVertical: 4, gap: 4 },
  rowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  rowBody: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  button: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flexGrow: 1 },
  choices: { flex: 1, flexDirection: 'row', gap: 6 },
  track: {
    height: 32,
    marginHorizontal: THUMB / 2,
    justifyContent: 'center',
  },
  rail: {
    position: 'absolute',
    height: 2,
    width: '100%',
    pointerEvents: 'none',
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    borderWidth: 2,
    pointerEvents: 'none',
  },
  shutter: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDot: { width: 42, height: 42, borderRadius: 21 },
  shutterStop: { width: 22, height: 22 },
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
