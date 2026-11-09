# lessdeaf iOS

SwiftUI app for iPhone (iOS 17 or later). It records the room and shows a
live transcript with speaker labels.

## Build

You need a Mac with Xcode 16 or later. XcodeGen makes the Xcode project from
`project.yml`, so git holds no `.xcodeproj`.

```bash
brew install xcodegen
cd apps/lessdeaf/ios
xcodegen generate
open LessDeaf.xcodeproj
```

In Xcode:

1. Select the `LessDeaf` target, then **Signing & Capabilities**. Set your team.
2. Connect the iPhone and select it as the run destination.
3. Run. Use a real device. The simulator has no Neural Engine and its mic
   input is not useful for this test.

Xcode gets FluidAudio from GitHub with Swift Package Manager (pinned to 0.18.x).

## First run

The first run downloads the models from Hugging Face (Parakeet TDT v3 and
LS-EEND). The badge at the top right shows "Loading models". Use Wi-Fi.

If the download fails, the badge shows "Record only". Recording still works.
Tap the badge to try again.

## Pipeline 1

| Stage | Model |
|---|---|
| ASR | FluidAudio Parakeet TDT v3, chunks of about 6 s cut at the quietest point |
| Diarization | FluidAudio LS-EEND, `dihard3` variant, streaming at 100 ms steps |
| Word to speaker | The speaker whose segments overlap the word most |

At the end of a session, the app assigns every word again on the full
diarization timeline and writes `live.json`.

## Files

| File | Purpose |
|---|---|
| `LessDeafApp.swift` | App entry and tabs |
| `Recorder.swift` | `AVAudioEngine` tap. Writes the WAV file and sends 16 kHz copies to the pipeline |
| `LivePipeline.swift` | Pipeline 1 |
| `SessionController.swift` | Starts and stops a session, and saves its files |
| `SessionModels.swift` | `session.json` and the common output format |
| `SessionStore.swift` | The session folders in `Documents/sessions` |
| `RecordView.swift`, `SessionsView.swift` | UI |

## Status

Written on Linux with no Swift compiler. Nobody has compiled or run the code
yet. Expect small compile errors on the first build.
