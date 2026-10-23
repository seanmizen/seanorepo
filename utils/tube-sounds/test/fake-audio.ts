// A small stand-in for the Web Audio API. Bun has no AudioContext.
//
// Every node is one FakeNode with all the parameters that the library
// uses. An automation call (set, ramp, target) sets the parameter value at
// once, so a test reads the most recent target of each parameter. Buffers
// keep their samples, so the sound bank builds as in a browser.

export class FakeParam {
  constructor(public value = 0) {}
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number): this {
    this.value = v;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

export class FakeBuffer {
  readonly duration: number;
  private readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.data = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }
  copyToChannel(src: Float32Array, ch: number): void {
    this.data[ch]?.set(src.subarray(0, this.length));
  }
  getChannelData(ch: number): Float32Array {
    const d = this.data[ch];
    if (!d) throw new RangeError(`FakeBuffer: channel ${ch} does not exist.`);
    return d;
  }
}

export class FakeNode {
  readonly outputs: unknown[] = [];
  gain = new FakeParam(1);
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  delayTime = new FakeParam(0);
  pan = new FakeParam(0);
  playbackRate = new FakeParam(1);
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
  type = '';
  buffer: FakeBuffer | null = null;
  loop = false;
  normalize = true;
  curve: Float32Array | null = null;
  oversample = 'none';
  onended: (() => void) | null = null;

  constructor(
    readonly context: FakeContext,
    readonly kind: string,
  ) {
    context.nodes.push(this);
  }
  connect<T>(dest: T): T {
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
  start(): void {}
  stop(): void {}
}

export class FakeContext {
  currentTime = 0;
  readonly nodes: FakeNode[] = [];
  constructor(readonly sampleRate = 16000) {}

  /** The fake, typed as the real context for the library. */
  get audio(): BaseAudioContext {
    return this as unknown as BaseAudioContext;
  }

  /** Nodes of one kind, for example 'gain' or 'delay'. */
  all(kind: string): FakeNode[] {
    return this.nodes.filter((n) => n.kind === kind);
  }

  createGain(): FakeNode {
    return new FakeNode(this, 'gain');
  }
  createBiquadFilter(): FakeNode {
    return new FakeNode(this, 'biquad');
  }
  createOscillator(): FakeNode {
    return new FakeNode(this, 'oscillator');
  }
  createDelay(): FakeNode {
    return new FakeNode(this, 'delay');
  }
  createStereoPanner(): FakeNode {
    return new FakeNode(this, 'panner');
  }
  createConvolver(): FakeNode {
    return new FakeNode(this, 'convolver');
  }
  createWaveShaper(): FakeNode {
    return new FakeNode(this, 'shaper');
  }
  createDynamicsCompressor(): FakeNode {
    return new FakeNode(this, 'compressor');
  }
  createBufferSource(): FakeNode {
    return new FakeNode(this, 'source');
  }
  createBuffer(
    channels: number,
    length: number,
    sampleRate: number,
  ): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
}
