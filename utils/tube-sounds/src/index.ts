// tube-sounds: procedural London Underground train sounds (Web Audio API).
//
//   const ctx = new AudioContext();
//   const station = new TubeStation(ctx);
//   station.output.connect(ctx.destination);
//   station.start();
//   const train = new TubeTrain(station, { stock: '1973' });
//   train.playService();

export {
  DEFAULT_GEOMETRY,
  type Listener,
  type SourcePath,
  type StationGeometry,
  sourcePath,
} from './core/geometry';
export {
  brakingProfile,
  departureProfile,
  hermiteProfile,
  type MotionProfile,
} from './core/kinematics';
export {
  type ArrivalOptions,
  arrivalScript,
  type ControlFrame,
  type DepartureOptions,
  departureScript,
  type Script,
  type ScriptEvent,
  type ServiceOptions,
  serviceScript,
} from './core/script';

export {
  axleOffsets,
  type CarSpec,
  carOffsets,
  type DoorType,
  gearRatio,
  type MotorType,
  STOCK_1973,
  STOCK_S7,
  STOCKS,
  type StockId,
  type StockSpec,
  trainLength,
  wheelHz,
} from './core/stock';
export {
  type Curve,
  curvatureAt,
  DEFAULT_TRACK,
  type TrackLayout,
} from './core/track';
export {
  type CarrierStep,
  GTO_SCHEDULE,
  IGBT_SCHEDULE,
  type PulseMode,
} from './core/vvvf';
export { type OfflineOptions, renderOffline } from './offline';
export { type StationOptions, type Ticked, TubeStation } from './station';
export {
  DEFAULT_MIX,
  type DoorsCloseOptions,
  type Mix,
  type MixComponent,
  type TrainOptions,
  type TrainState,
  TubeTrain,
} from './train';
