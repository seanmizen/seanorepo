// Build a readable ffmpeg command string from an op name + args.
// Mirrors the logic in apps/ffmpeg-converter/ops.go. The goal is NOT byte-
// exact equivalence (the server can diverge); it's an *honest approximation*
// so power users can copy-paste into their own shell and iterate.
//
// If you change an op's flags in ops.go, change them here too.

import type { Preset } from './ops';

// Escape a value that might contain spaces or quotes, using POSIX shell rules.
function sh(v: string): string {
  if (v === '') return "''";
  // If it has no shell-special chars, leave it bare.
  if (/^[A-Za-z0-9._/@:=+-]+$/.test(v)) return v;
  return "'" + v.replace(/'/g, `'"'"'`) + "'";
}

export function buildFfmpegCmd(
  opName: string,
  args: Record<string, string>,
  inputName: string,
  outputName: string,
): string {
  const input = inputName || 'input';
  const output = outputName || 'output';
  const prefix = ['ffmpeg', '-hide_banner', '-y'];

  // Mirror the backend's arg defaults from ops.go.
  const get = (k: string, def: string) => args[k] ?? def;

  switch (opName) {
    case 'transcode':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '30',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        sh(output),
      ].join(' ');
    case 'transcode_webm':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-c:v',
        'libvpx-vp9',
        '-b:v',
        '200k',
        '-deadline',
        'realtime',
        '-c:a',
        'libopus',
        '-b:a',
        '48k',
        sh(output),
      ].join(' ');
    case 'transcode_mkv':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '30',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        sh(output),
      ].join(' ');
    case 'resize': {
      const w = get('width', '64');
      const h = get('height', '36');
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vf',
        sh(`scale=${w}:${h}`),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '30',
        '-c:a',
        'copy',
        sh(output),
      ].join(' ');
    }
    case 'h264_to_h265':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-c:v',
        'libx265',
        '-preset',
        'ultrafast',
        '-crf',
        '32',
        '-tag:v',
        'hvc1',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        sh(output),
      ].join(' ');
    case 'change_framerate':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-r',
        get('fps', '15'),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '30',
        '-c:a',
        'copy',
        sh(output),
      ].join(' ');
    case 'change_bitrate':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-b:v',
        get('bitrate', '150k'),
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        sh(output),
      ].join(' ');
    case 'trim':
      return [
        ...prefix,
        '-ss',
        get('start', '0'),
        '-i',
        sh(input),
        '-t',
        get('duration', '1'),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '30',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        sh(output),
      ].join(' ');
    case 'thumbnail':
      return [
        ...prefix,
        '-ss',
        get('timestamp', '00:00:00.3'),
        '-i',
        sh(input),
        '-frames:v',
        '1',
        '-q:v',
        '5',
        sh(output),
      ].join(' ');
    case 'contact_sheet': {
      const cols = get('cols', '3');
      const rows = get('rows', '3');
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vf',
        sh(`select='not(mod(n,3))',scale=64:36,tile=${cols}x${rows}`),
        '-frames:v',
        '1',
        '-q:v',
        '5',
        sh(output),
      ].join(' ');
    }
    case 'speed': {
      const f = get('factor', '2.0');
      return [
        ...prefix,
        '-i',
        sh(input),
        '-filter_complex',
        sh(`[0:v]setpts=PTS/${f}[v];[0:a]atempo=${f}[a]`),
        '-map',
        '[v]',
        '-map',
        '[a]',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '30',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        sh(output),
      ].join(' ');
    }
    case 'reverse':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vf',
        'reverse',
        '-af',
        'areverse',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '30',
        sh(output),
      ].join(' ');
    case 'crop': {
      const w = get('width', '64'),
        h = get('height', '36'),
        x = get('x', '0'),
        y = get('y', '0');
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vf',
        sh(`crop=${w}:${h}:${x}:${y}`),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '30',
        '-c:a',
        'copy',
        sh(output),
      ].join(' ');
    }
    case 'rotate': {
      const deg = get('degrees', '90');
      let vf = 'transpose=1';
      if (deg === '180') vf = 'transpose=1,transpose=1';
      else if (deg === '270') vf = 'transpose=2';
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '30',
        '-c:a',
        'copy',
        sh(output),
      ].join(' ');
    }
    case 'flip': {
      const vf = get('direction', 'h') === 'v' ? 'vflip' : 'hflip';
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '30',
        '-c:a',
        'copy',
        sh(output),
      ].join(' ');
    }
    case 'audio_mp3':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vn',
        '-c:a',
        'libmp3lame',
        '-b:a',
        get('bitrate', '64k'),
        sh(output),
      ].join(' ');
    case 'audio_opus':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vn',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        sh(output),
      ].join(' ');
    case 'audio_aac':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        sh(output),
      ].join(' ');
    case 'audio_flac':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vn',
        '-c:a',
        'flac',
        sh(output),
      ].join(' ');
    case 'extract_audio':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vn',
        '-acodec',
        'pcm_s16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        sh(output),
      ].join(' ');
    case 'normalize_audio':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-af',
        sh('loudnorm=I=-16:TP=-1.5:LRA=11'),
        '-ar',
        '44100',
        sh(output),
      ].join(' ');
    case 'audio_trim':
      return [
        ...prefix,
        '-ss',
        get('start', '0'),
        '-i',
        sh(input),
        '-t',
        get('duration', '0.5'),
        '-c:a',
        'pcm_s16le',
        sh(output),
      ].join(' ');
    case 'audio_bitrate':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vn',
        '-c:a',
        'libmp3lame',
        '-b:a',
        get('bitrate', '96k'),
        sh(output),
      ].join(' ');
    case 'stereo_to_mono':
      return [...prefix, '-i', sh(input), '-ac', '1', sh(output)].join(' ');
    case 'time_stretch':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-af',
        'atempo=' + get('factor', '1.5'),
        '-c:a',
        'pcm_s16le',
        sh(output),
      ].join(' ');
    case 'spectrogram':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-lavfi',
        sh('showspectrumpic=s=320x180'),
        sh(output),
      ].join(' ');
    case 'waveform_png':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-filter_complex',
        sh('aformat=channel_layouts=mono,showwavespic=s=320x80:colors=white'),
        '-frames:v',
        '1',
        sh(output),
      ].join(' ');
    case 'image_resize': {
      const w = get('width', '64'),
        h = get('height', '-1');
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vf',
        sh(`scale=${w}:${h}`),
        sh(output),
      ].join(' ');
    }
    case 'image_to_jpg':
      return [...prefix, '-i', sh(input), '-q:v', '5', sh(output)].join(' ');
    case 'image_to_png':
      return [...prefix, '-i', sh(input), sh(output)].join(' ');
    case 'image_to_webp':
      return [...prefix, '-i', sh(input), '-q:v', '60', sh(output)].join(' ');
    case 'image_to_avif':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-c:v',
        'libaom-av1',
        '-still-picture',
        '1',
        '-cpu-used',
        '8',
        sh(output),
      ].join(' ');
    case 'gif_from_video':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vf',
        sh(
          'fps=10,scale=96:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
        ),
        sh(output),
      ].join(' ');
    case 'blur':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vf',
        sh('gblur=sigma=' + get('sigma', '3')),
        sh(output),
      ].join(' ');
    case 'sharpen':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vf',
        sh('unsharp=5:5:1.0:5:5:0.0'),
        sh(output),
      ].join(' ');
    case 'grayscale':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-vf',
        'format=gray',
        sh(output),
      ].join(' ');
    case 'youtube_preview':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-t',
        get('seconds', '1'),
        '-vf',
        sh(
          'fps=10,scale=96:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
        ),
        sh(output),
      ].join(' ');
    case 'silence_trim':
      return [
        ...prefix,
        '-i',
        sh(input),
        '-af',
        sh(
          'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB:stop_periods=1:stop_silence=0.05:stop_threshold=-50dB',
        ),
        '-c:a',
        'pcm_s16le',
        sh(output),
      ].join(' ');
    default:
      return `# TODO: ${opName} — command preview not yet mirrored in the frontend`;
  }
}

export function buildCurlCmd(
  opName: string,
  args: Record<string, string>,
  inputName: string,
  host = 'http://localhost:9876',
): string {
  const parts = [`curl -s -X POST ${host}/convert`];
  parts.push(`  -F 'op=${opName}'`);
  parts.push(`  -F 'file=@${inputName || 'input.ext'}'`);
  for (const [k, v] of Object.entries(args)) {
    if (v === '') continue;
    parts.push(`  -F '${k}=${v}'`);
  }
  return parts.join(' \\\n');
}

// Suggest a reasonable output filename given the input + preset.
export function suggestOutputName(
  inputName: string,
  preset: Preset,
  argsExt?: string,
): string {
  const base = inputName.replace(/\.[^.]+$/, '') || 'output';
  const ext = argsExt
    ? argsExt.startsWith('.')
      ? argsExt
      : '.' + argsExt
    : preset.outputExt;
  return base + ext;
}
