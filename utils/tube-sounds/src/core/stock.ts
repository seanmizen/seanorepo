// Rolling stock data. The sound models read their frequencies from these
// numbers: gear teeth and wheel size set the whine, axle spacing sets the
// rail-joint rhythm. Change the train and the sound changes with it.
//
// Sources: TfL rolling stock information sheets (1973 Stock: LT118 motors,
// 17/75 gears, 790 mm new / 710 mm worn wheels) and the S7 Stock data on
// Wikipedia (car lengths, 770-710 mm wheels, 2.08 m wheelbase, IGBT VVVF).
// Values marked "approx" are estimates where no source gives a number.

export type MotorType = 'dc-camshaft' | 'vvvf-igbt' | 'vvvf-gto';
export type DoorType = 'pneumatic' | 'electric';

export interface CarSpec {
  /** Length over couplers, metres. */
  length: number;
  /** True when the car has traction motors. */
  motored: boolean;
  /** Distance between the two bogie pivots, metres. */
  bogieCentres: number;
  /** Axle spacing inside one bogie, metres. */
  wheelbase: number;
  /** True when an air compressor hangs under this car. */
  compressor: boolean;
}

export interface StockSpec {
  id: StockId;
  name: string;
  cars: CarSpec[];
  /** Wheel diameter new and fully worn, metres. Each car gets a value between. */
  wheelDiameterNew: number;
  wheelDiameterWorn: number;
  /** Teeth on the axle gear wheel and on the motor pinion. */
  gearTeeth: number;
  pinionTeeth: number;
  motor: MotorType;
  /** Pole pairs of an AC traction motor (VVVF only). */
  polePairs: number;
  /** Commutator segments of a DC traction motor (DC only). */
  commutatorSegments: number;
  doors: DoorType;
  /** Door leaves per car side (double doors count as one opening). */
  doorsPerSide: number;
  /** True when the doors chime as they open. */
  openChime: boolean;
  maxSpeed: number;
  /** Full-throttle acceleration, m/s^2. */
  maxAccel: number;
  /** Full-service brake deceleration, m/s^2. */
  serviceDecel: number;
  /** Below this speed the electric brake fades and the friction brake takes over, m/s. */
  electricBrakeFade: number;
}

export type StockId = '1973' | 'S7';

const car73 = (
  length: number,
  motored: boolean,
  compressor = false,
): CarSpec => ({
  length,
  motored,
  bogieCentres: 11.6, // approx
  wheelbase: 1.905, // approx (6 ft 3 in)
  compressor,
});

/** Piccadilly line 1973 Stock: 6 cars, DM-T-UNDM + UNDM-T-DM. */
export const STOCK_1973: StockSpec = {
  id: '1973',
  name: '1973 Stock (Piccadilly line)',
  cars: [
    car73(17.473, true),
    car73(17.676, false, true),
    car73(17.676, true),
    car73(17.676, true),
    car73(17.676, false, true),
    car73(17.473, true),
  ],
  wheelDiameterNew: 0.79,
  wheelDiameterWorn: 0.71,
  gearTeeth: 75,
  pinionTeeth: 17,
  motor: 'dc-camshaft',
  polePairs: 2,
  commutatorSegments: 135, // approx
  doors: 'pneumatic',
  doorsPerSide: 4,
  openChime: false,
  maxSpeed: 20, // 72 km/h
  maxAccel: 1.3,
  serviceDecel: 1.15,
  electricBrakeFade: 3.5,
};

const carS7 = (length: number, compressor = false): CarSpec => ({
  length,
  motored: true,
  bogieCentres: length > 17 ? 12.3 : 10.4, // approx
  wheelbase: 2.08,
  compressor,
});

/** District line S7 Stock: 7 cars, Bombardier MITRAC IGBT VVVF. */
export const STOCK_S7: StockSpec = {
  id: 'S7',
  name: 'S7 Stock (District line)',
  cars: [
    carS7(18.139),
    carS7(16.234, true),
    carS7(16.234),
    carS7(16.234),
    carS7(16.234),
    carS7(16.234, true),
    carS7(18.139),
  ],
  wheelDiameterNew: 0.77,
  wheelDiameterWorn: 0.71,
  gearTeeth: 98, // approx
  pinionTeeth: 15, // approx
  motor: 'vvvf-igbt',
  polePairs: 2,
  commutatorSegments: 0,
  doors: 'electric',
  doorsPerSide: 3,
  openChime: true,
  maxSpeed: 27.8, // 100 km/h
  maxAccel: 1.3,
  serviceDecel: 1.15,
  electricBrakeFade: 1.5,
};

export const STOCKS: Record<StockId, StockSpec> = {
  '1973': STOCK_1973,
  S7: STOCK_S7,
};

export const gearRatio = (s: StockSpec): number => s.gearTeeth / s.pinionTeeth;

export const trainLength = (s: StockSpec): number =>
  s.cars.reduce((sum, c) => sum + c.length, 0);

/** Distance from the train front to the front of each car, metres. */
export const carOffsets = (s: StockSpec): number[] => {
  const out: number[] = [];
  let x = 0;
  for (const c of s.cars) {
    out.push(x);
    x += c.length;
  }
  return out;
};

/**
 * Distance from the train front to every axle, metres, in order from the
 * front. Each car has two bogies, and each bogie has two axles.
 */
export const axleOffsets = (s: StockSpec): number[] => {
  const out: number[] = [];
  const fronts = carOffsets(s);
  s.cars.forEach((c, i) => {
    const front = fronts[i] ?? 0;
    const overhang = (c.length - c.bogieCentres) / 2;
    for (const pivot of [overhang, overhang + c.bogieCentres]) {
      out.push(
        front + pivot - c.wheelbase / 2,
        front + pivot + c.wheelbase / 2,
      );
    }
  });
  return out;
};

/** Wheel revolutions per second at a given train speed. */
export const wheelHz = (speed: number, wheelDiameter: number): number =>
  Math.max(0, speed) / (Math.PI * wheelDiameter);
