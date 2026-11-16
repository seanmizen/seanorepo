# timelapse

A timelapse camera app. One Expo (React Native) codebase runs on three
targets: the web, iOS and Android. The web build is a static site at
`timelapse.seanmizen.com`, on port 4120.

The app has one screen. From top to bottom:

1. The camera preview. After a capture, the playback shows here.
2. The settings: the interval between frames, the stop condition (by hand,
   after N frames, or after a time), the playback frame rate, the camera, and
   the estimated frame count and video length. The settings scroll when they
   do not fit.
3. The bottom bar: the shutter starts and stops a capture. After a capture,
   "Discard" and "Download" (web) or "Save" (phone) show at the sides.

## Run the web dev server

From the root of the monorepo:

```bash
yarn workspace timelapse web
```

Open `http://localhost:8081` in Chrome. Chrome asks for the webcam. The
browser gives the webcam only to a secure context: HTTPS, or `localhost`.

## Open the app in Expo Go

1. Install Expo Go on the phone, from the App Store or Google Play.
2. Connect the phone to the same Wi-Fi network as the computer.
3. From the root of the monorepo, start the dev server:

   ```bash
   yarn timelapse
   ```

4. Scan the QR code in the terminal. On iOS, use the Camera app. On Android,
   use the scanner in Expo Go.

The app uses Expo SDK 58. The Expo Go app in the stores runs only the latest
SDK. When Expo Go shows an SDK error, upgrade the app to the SDK that Expo Go
runs.

## Build

```bash
yarn workspace timelapse build                            # the web build, in dist/
yarn workspace timelapse expo export --platform ios       # a check of the iOS bundle
yarn workspace timelapse expo export --platform android   # a check of the Android bundle
yarn workspace timelapse typecheck
```

The iOS and Android exports write to `dist/` too. Delete `dist/` after a
check.

## Docker

```bash
yarn workspace timelapse prod:docker   # the web build, served on 127.0.0.1:4120
yarn workspace timelapse down
```

`dockerfile` and `docker-compose.yml` follow the pattern of `apps/thirty`.
The Cloudflare tunnel sends `timelapse.seanmizen.com` to port 4120.

## How it works

The screen code is in `src/App.tsx`. The camera and the playback each have
two files with the same exports. Metro selects the `.web.tsx` file for the
web build:

| Part | Web | iOS and Android |
|---|---|---|
| Camera | `getUserMedia`. The browser shows its permission prompt. A frame is a JPEG blob, at most 1280 px on the longest side. The camera list comes from `enumerateDevices`. | `expo-camera`. The app asks for the camera permission. A frame is a JPEG photo in the cache folder. The camera list is "Back" and "Front". |
| Playback | A loop draws the frames on a `<canvas>`. | `expo-image` shows the frames one after the other. |
| Output | During the first playback pass, `MediaRecorder` records the canvas. "Download" saves the video file: WebM in Chrome and Firefox, MP4 in Safari. | "Save" adds each frame to the photo library. Expo Go has no video encoder, so the phone saves photos and not a video file. |

The web recording runs in real time. A capture of 300 frames at 30 fps takes
10 seconds to record. The browser slows the timers of a hidden tab, so keep
the tab visible until "Download" shows the file size.

When the user refuses the camera permission, or no camera exists, the
preview area shows a message and a button. The shutter stays off.

### Frames in an iframe

`serve` sends no `X-Frame-Options` header and no `Content-Security-Policy`.
seanmizen.com can show the app in `<iframe allow="camera">`.

### The LAN edge

The edge (`infra/edge`) serves the page on plain HTTP. Plain HTTP is not a
secure context, so the browser gives the page no webcam there. The page
shows a message.

### React versions

Expo pins exact versions: React 19.3.0 and React Native 0.88.1. The other
workspaces use React 19.2. `package.json` sets
`installConfig.hoistingLimits: "workspaces"`, so Yarn puts all the packages
of this workspace in `apps/timelapse/node_modules`. The root `node_modules`
keeps React 19.2 for the other workspaces.
