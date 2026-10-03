# sonycam

Live view and remote recording for a Sony A6000, with no extra hardware.

The A6000 is not a USB webcam, and Sony Imaging Edge Webcam does not support
it. This app reads the camera's live view stream over Wi-Fi or USB and serves
it as one MJPEG stream. OBS turns that stream into a webcam.

```bash
yarn sonycam          # http://localhost:4070
```

| Source | Live view | Record video | Take photo | Setup |
|---|---|---|---|---|
| Wi-Fi | Yes | Yes, full quality, to the camera's SD card | Yes | Join the camera's Wi-Fi |
| USB | Yes | No | No | usbipd + gphoto2 in WSL |

Live view from either source is low resolution (about 640×424) at about 10 to
15 fps. That is the camera's preview stream, not its video output. For a full
1080p webcam, use an HDMI capture dongle (see the end of this file).

## Where it runs

`bun` on this PC is the Windows build, so the server is a Windows process.
Windows joins the camera's Wi-Fi, and OBS reaches the server on `localhost`.
The USB source runs `gphoto2` inside WSL through `wsl.exe`.

## Wi-Fi setup

1. On the camera: **Menu → Application → Application List → Smart Remote
   Embedded**. The camera shows a network name (`DIRECT-xxxx:ILCE-6000`) and a
   password. If the app is not in the list, update the camera firmware.
2. On the PC: connect to that Wi-Fi network. The PC loses internet while it is
   connected.
3. In sonycam, click **Wi-Fi**.

The server tries `http://192.168.122.1:8080/sony`, then port `10000`. To use a
different address, set `SONYCAM_CAMERA_URL`.

**Record** starts and stops a movie on the camera's SD card at full quality.
**Photo** takes a still. Copy the files from the SD card afterwards.

## USB setup

1. On the camera: **Menu → Setup → USB Connection → PC Remote**. Connect the
   camera with its micro-USB cable.
2. On Windows, install usbipd-win once: `winget install usbipd`.
3. In an administrator PowerShell, find and share the camera once:

   ```powershell
   usbipd list                      # find the Sony camera's BUSID
   usbipd bind --busid <BUSID>
   ```

4. Each time you connect the camera: `usbipd attach --wsl --busid <BUSID>`.
   While WSL has the camera, Windows cannot see it.
5. In WSL, install gphoto2 once: `sudo apt install gphoto2`. Test it:
   `gphoto2 --auto-detect`.
6. In sonycam, click **USB**.

## Use it as a webcam (OBS)

1. Install OBS Studio.
2. Add a **Browser Source**. URL: `http://localhost:4070/view`. Width 1280,
   height 720.
3. Click **Start Virtual Camera**.
4. In Zoom, Teams, Discord or the browser, choose **OBS Virtual Camera**.

The `/view` page reconnects by itself when the source changes or the server
restarts.

## API

All routes are under `/api`.

| Route | Does |
|---|---|
| `GET /api/status` | Active source, recording state, frame count, viewer count |
| `POST /api/source` `{"kind":"wifi"\|"usb"}` | Start a source (stops the previous one) |
| `DELETE /api/source` | Stop the source |
| `GET /api/live.mjpeg` | Live view as `multipart/x-mixed-replace` |
| `GET /api/frame.jpg` | The latest frame |
| `POST /api/record` `{"on":true\|false}` | Start or stop movie recording (Wi-Fi) |
| `POST /api/photo` | Take a photo (Wi-Fi) |

## Limits

- **Battery.** The A6000 does not run from USB power. One battery gives about
  1 to 1.5 hours of live view. For long sessions, use a dummy battery
  (NP-FW50 shape) on a mains adapter.
- **Clip length.** The A6000 stops each recording at 29 minutes 59 seconds.
  Live view continues.
- **Heat.** Long live view sessions make the camera warm. It can shut down
  to protect itself.
- **One source at a time.** In USB mode the camera does not accept Wi-Fi
  control.

## Full-quality webcam: HDMI capture

The camera's micro-HDMI output carries a clean 1080p picture. Set **Menu →
Setup → HDMI Info. Display → Off** to remove the on-screen overlays. A USB
HDMI capture dongle shows on Windows as a normal webcam, and this app is not
needed. A PC's own HDMI ports are outputs only and cannot receive video.

## Tests

```bash
yarn workspace sonycam test        # stream parsers and a fake camera
yarn workspace sonycam typecheck
```
