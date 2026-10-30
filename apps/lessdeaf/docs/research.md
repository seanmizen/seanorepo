# Research

Initial research, October 2026. The figures are estimates from public
sources and model sizes. Measure them on a real device before you trust them.

## Pipeline stages

| Stage | Purpose | Typical models | Size |
|---|---|---|---|
| Voice activity detection (VAD) | Find the parts that contain speech | Silero VAD | About 2 MB |
| Noise reduction (optional) | Remove noise, or split overlapping voices | DeepFilterNet, Apple voice processing, SepFormer, TF-GridNet | Varies |
| ASR | Speech to text | Whisper large-v3-turbo, NVIDIA Parakeet-TDT, Apple SpeechTranscriber | About 600-800M parameters |
| Segmentation | Find speaker changes and overlap | pyannote segmentation | About 1.5M parameters |
| Speaker embedding | Give each voice a vector | ECAPA-TDNN, WeSpeaker ResNet, TitaNet | About 6-25M parameters |
| Clustering or end-to-end diarization | Group segments by speaker | Agglomerative or spectral clustering, NVIDIA Sortformer | Small |

## Compute budget on iPhone

- Apple rates the A18 Pro and A19 Pro Neural Engines at about 35 TOPS. The A19
  Pro also has matrix units in the GPU.
- ASR is about 90% of the compute. The diarization models are tiny next to it.
- On the Neural Engine, Parakeet and Whisper-turbo run many times faster than
  real time. Live transcription uses only a small part of the chip.
- Expect about 1-2 W of sustained power. An hour-long session uses battery but
  should not cause a thermal shutdown.
- Older chips (iPhone 13 class) can also run live with smaller models.

Conclusion: compute is not the limit. Audio quality and overlapping speech are
the limits.

## Hardware limits

- iOS gives apps only limited access to the separate mics in the phone. True
  beamforming from the built-in mics is mostly not available to an app.
- `AVAudioSession` voice-processing mode applies Apple's own noise suppression.
  Apple tunes it for calls, not for a room of speakers. Test it as one option.
- An external USB-C mic array (for example a ReSpeaker-type array) gives
  multi-channel audio and real beamforming.

## Benchmarks

Far-field benchmarks with overlapping speech (CHiME-6, AMI far-field) still
show diarization error rates of about 20-40%. Close-talk and clean benchmarks
show much lower rates. Our target rooms are nearer to the far-field case.

## Existing software

### On-device, iOS and Swift

| Software | ASR | Diarization | Notes |
|---|---|---|---|
| Apple SpeechAnalyzer / SpeechTranscriber (iOS 26) | Yes | No public API | Fast, free, on-device |
| WhisperKit + SpeakerKit (Argmax) | Whisper | pyannote-style | Most polished commercial SDK, Neural Engine |
| FluidAudio (open source) | Parakeet | pyannote | CoreML models, probably the fastest way to a prototype |
| sherpa-onnx (k2-fsa) | Many models, streaming | Yes | Runs on many platforms, including iOS |
| whisper.cpp | Whisper | No | Stable, runs anywhere |

### Server and Python

| Software | Purpose |
|---|---|
| pyannote.audio (3.x, community-1) and pyannoteAI | The standard for diarization |
| WhisperX | Whisper, word timestamps and pyannote in one tool |
| NVIDIA NeMo | Parakeet and Canary for ASR, Sortformer for streaming diarization |
| SpeechBrain, ESPnet | SepFormer and TF-GridNet speech separation. Heavy, not live on a phone |

### Cloud APIs with diarization

AssemblyAI, Deepgram, Speechmatics (strong on noisy audio), ElevenLabs Scribe,
OpenAI `gpt-4o-transcribe-diarize`, Google Chirp, AWS Transcribe.

### Finished apps to test against

Otter.ai, MacWhisper, Aiko, Plaud (hardware recorder).
