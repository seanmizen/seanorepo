// The one screen. From top to bottom: the camera preview (or the playback),
// the settings in a scroll view, and the bottom bar with the shutter.

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { Camera, releaseFrames } from './camera/Camera';
import { Playback } from './playback/Playback';
import {
  DEFAULT_SETTINGS,
  DURATIONS_S,
  estimate,
  FPS_CHOICES,
  FRAME_LIMITS,
  formatClock,
  formatSeconds,
  INTERVALS_S,
  type Settings,
  type StopMode,
  targetFrames,
} from './settings';
import type { CameraDevice, CameraHandle, Frame, OutputAction } from './types';
import {
  Button,
  Choice,
  FONT,
  Label,
  Row,
  Shutter,
  Slider,
  useTheme,
} from './ui';

const MAX_WIDTH = 640;
const KEEP_AWAKE_TAG = 'timelapse-capture';

type Phase = 'live' | 'capturing' | 'result';

/** Lets the shutter stop the capture loop while it waits for the next frame. */
type CaptureRun = { stopped: boolean; wake: () => void };

export default function App() {
  return (
    <SafeAreaProvider>
      <Screen />
    </SafeAreaProvider>
  );
}

function Screen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraHandle>(null);
  const run = useRef<CaptureRun | null>(null);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeCamera, setActiveCamera] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('live');
  const [frames, setFrames] = useState<Frame[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [action, setAction] = useState<OutputAction | null>(null);
  const [notice, setNotice] = useState('');

  const capturing = phase === 'capturing';
  const est = estimate(settings);
  const target = targetFrames(settings);

  useEffect(() => {
    if (!capturing) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [capturing]);

  const change = (patch: Partial<Settings>) =>
    setSettings((s) => ({ ...s, ...patch }));

  const onDevices = (list: CameraDevice[], activeId: string) => {
    setDevices(list);
    setActiveCamera(activeId);
  };

  const startCapture = async () => {
    releaseFrames(frames);
    setFrames([]);
    setAction(null);
    setNotice('');
    const self: CaptureRun = { stopped: false, wake: () => {} };
    run.current = self;
    const begin = Date.now();
    setStartedAt(begin);
    setNow(begin);
    setPhase('capturing');
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});

    const intervalMs = settings.intervalS * 1000;
    const limit = targetFrames(settings);
    const taken: Frame[] = [];
    while (!self.stopped && (limit === null || taken.length < limit)) {
      // Frame n is due at n intervals after the start. When a capture takes
      // longer than the interval, the next capture starts at once.
      const wait = begin + taken.length * intervalMs - Date.now();
      if (wait > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, wait);
          self.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
      if (self.stopped) break;
      try {
        const frame = await camera.current?.capture();
        if (!frame) throw new Error('The camera is not open.');
        taken.push(frame);
        setFrames([...taken]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setNotice(`The capture stopped: ${message}`);
        break;
      }
    }

    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    run.current = null;
    setPhase(taken.length > 0 ? 'result' : 'live');
  };

  const stopCapture = () => {
    const current = run.current;
    if (!current) return;
    current.stopped = true;
    current.wake();
  };

  const discard = () => {
    releaseFrames(frames);
    setFrames([]);
    setAction(null);
    setNotice('');
    setPhase('live');
  };

  const selectedCamera = settings.cameraId || activeCamera;
  const cameraIndex = devices.findIndex((d) => d.id === selectedCamera);
  const nextCamera = () =>
    change({ cameraId: devices[(cameraIndex + 1) % devices.length].id });

  const interval = INTERVALS_S.indexOf(settings.intervalS);
  const stepInterval = (by: number) =>
    change({ intervalS: INTERVALS_S[interval + by] });

  // The - and + of the Stop row change the frame count or the time.
  const stopList = settings.stop === 'frames' ? FRAME_LIMITS : DURATIONS_S;
  const stopValue =
    settings.stop === 'frames' ? settings.stopFrames : settings.stopDurationS;
  const stopIndex = stopList.indexOf(stopValue);
  const stepStop = (by: number) => {
    const next = stopList[stopIndex + by];
    change(
      settings.stop === 'frames'
        ? { stopFrames: next }
        : { stopDurationS: next },
    );
  };
  const stopText = {
    hand: 'by hand',
    frames: `after ${settings.stopFrames} frames`,
    duration: `after ${formatSeconds(settings.stopDurationS)}`,
  }[settings.stop];
  const estimateText =
    est.frames === null
      ? `Each minute makes ${round(est.perMinute.frames)} frames, ${formatSeconds(est.perMinute.videoS)} of video.`
      : `${est.frames} frames over ${formatSeconds(est.captureS ?? 0)} make ${formatSeconds(est.videoS ?? 0)} of video.`;

  return (
    <View
      style={[
        styles.page,
        { backgroundColor: theme.bg, paddingTop: insets.top },
      ]}
    >
      <StatusBar style="auto" />
      <View style={[styles.column, { maxWidth: MAX_WIDTH }]}>
        <View style={styles.preview}>
          <Camera
            ref={camera}
            deviceId={settings.cameraId}
            onDevices={onDevices}
            onReady={setCameraReady}
          />
          {phase === 'result' && frames.length > 0 && (
            <Playback frames={frames} fps={settings.fps} onAction={setAction} />
          )}
          {capturing && (
            <View style={styles.badge}>
              <View style={styles.badgeDot} />
              <Text style={styles.badgeText}>
                {frames.length}
                {target === null ? '' : ` / ${target}`}
              </Text>
            </View>
          )}
          {phase === 'live' && devices.length > 1 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Switch the camera. Now: ${devices[cameraIndex]?.label ?? 'none'}`}
              onPress={nextCamera}
              style={styles.switch}
            >
              <Text numberOfLines={1} style={styles.switchText}>
                ⇄ {devices[cameraIndex]?.label ?? 'Camera'}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.settings}>
          <Row
            label="Interval between frames"
            value={formatSeconds(settings.intervalS)}
          >
            <Button
              label="-"
              disabled={capturing || interval <= 0}
              onPress={() => stepInterval(-1)}
            />
            <Slider
              label="Interval between frames"
              values={INTERVALS_S}
              value={settings.intervalS}
              format={formatSeconds}
              onChange={(intervalS) => change({ intervalS })}
              disabled={capturing}
            />
            <Button
              label="+"
              disabled={capturing || interval >= INTERVALS_S.length - 1}
              onPress={() => stepInterval(1)}
            />
          </Row>

          <Row label="Stop" value={stopText}>
            <Choice<StopMode>
              options={[
                { value: 'hand', label: 'Hand' },
                { value: 'frames', label: 'Frames' },
                { value: 'duration', label: 'Time' },
              ]}
              value={settings.stop}
              onChange={(stop) => change({ stop })}
              disabled={capturing}
            />
            <Button
              label="-"
              disabled={capturing || settings.stop === 'hand' || stopIndex <= 0}
              onPress={() => stepStop(-1)}
            />
            <Button
              label="+"
              disabled={
                capturing ||
                settings.stop === 'hand' ||
                stopIndex >= stopList.length - 1
              }
              onPress={() => stepStop(1)}
            />
          </Row>

          <Row
            label="Playback frame rate"
            value={`plays ${round(est.speedup)}x faster`}
          >
            <Choice<number>
              options={FPS_CHOICES.map((fps) => ({
                value: fps,
                label: `${fps} fps`,
              }))}
              value={settings.fps}
              onChange={(fps) => change({ fps })}
              disabled={capturing}
            />
          </Row>

          <Label muted size={12}>
            {estimateText}
          </Label>
        </View>

        {notice !== '' && (
          <Text style={[styles.notice, { color: theme.fg }]}>{notice}</Text>
        )}

        <View
          style={[
            styles.bar,
            { paddingBottom: insets.bottom + 8, borderColor: theme.fg },
          ]}
        >
          <View style={styles.barSide}>
            {phase === 'live' && (
              <Label muted>{cameraReady ? 'Ready' : 'No camera'}</Label>
            )}
            {capturing && (
              <>
                <Label>
                  {frames.length} {frames.length === 1 ? 'frame' : 'frames'}
                </Label>
                <Label muted>{formatClock(now - startedAt)}</Label>
              </>
            )}
            {phase === 'result' && (
              <>
                <Button label="Discard" onPress={discard} />
                <Label muted>
                  {frames.length} frames,{' '}
                  {formatSeconds(frames.length / settings.fps)}
                </Label>
              </>
            )}
          </View>
          <Shutter
            recording={capturing}
            disabled={!capturing && !cameraReady}
            onPress={capturing ? stopCapture : startCapture}
          />
          <View style={[styles.barSide, styles.barRight]}>
            {phase === 'result' && action && (
              <>
                <Button
                  label={action.label}
                  disabled={!action.run}
                  onPress={() => action.run?.()}
                />
                <Label muted>{action.note}</Label>
              </>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function round(n: number): string {
  return String(Math.round(n * 10) / 10);
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%' },
  preview: {
    flex: 1,
    minHeight: 120,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#e00' },
  badgeText: { color: '#eee', fontFamily: FONT, fontSize: 14 },
  switch: {
    position: 'absolute',
    top: 8,
    right: 8,
    maxWidth: '60%',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  switchText: { color: '#eee', fontFamily: FONT, fontSize: 13 },
  settings: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6, gap: 2 },
  notice: {
    fontFamily: FONT,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
  },
  barSide: { flex: 1, gap: 4, alignItems: 'flex-start' },
  barRight: { alignItems: 'flex-end' },
});
