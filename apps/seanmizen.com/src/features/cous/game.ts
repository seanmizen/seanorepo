// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-Chromium file in this directory.
//
// Adapted from the Chromium offline-game source
// (components/neterror/resources/dino_game/*.ts):
//   - Class structure (Trex / Cloud / HorizonLine / Obstacle / DistanceMeter
//     / Horizon / Game) preserved.
//   - Constants (gravity, jump velocity, gap coefficient, animation frame
//     timings, collision boxes, obstacle types) preserved verbatim.
//   - Sprite addressing matches the original: every draw is 9-arg
//     `drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh)`. Source UV is
//     `theme.positions[group] + frameOffset × theme.scale`. The active
//     theme is one of `SPRITE_THEMES` in ./sprites.ts.
//   - Removed: sound FX, alt game mode, mobile-speed coefficient, RTL,
//     audio cues, achievement flashing.

import {
  CANVAS,
  DIGITS,
  SPRITES,
  type Sprite,
  type SpriteName,
  type SpriteTheme,
} from './sprites';

const FPS = 60;

/**
 * Draws a named sprite from the active theme's sheet at (dx, dy).
 * Composes the source UV from the theme's group position plus the
 * sprite's logical (1×) sub-offset, scaled by the theme's `scale`.
 */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  theme: SpriteTheme,
  name: SpriteName,
  dx: number,
  dy: number,
) {
  const s = SPRITES[name] as Sprite;
  const groupPos = theme.positions[s.group];
  const sx = groupPos.x + (s.frameX ?? 0) * theme.scale;
  const sy = groupPos.y + (s.frameY ?? 0) * theme.scale;
  ctx.drawImage(
    sheet,
    sx,
    sy,
    s.width * theme.scale,
    s.height * theme.scale,
    dx,
    dy,
    s.width,
    s.height,
  );
}

class CollisionBox {
  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
  ) {}
}

// ── Trex ─────────────────────────────────────────────────────────────────

const Status = {
  CRASHED: 0,
  DUCKING: 1,
  JUMPING: 2,
  RUNNING: 3,
  WAITING: 4,
} as const;
type Status = (typeof Status)[keyof typeof Status];

const defaultTrexConfig = {
  dropVelocity: -5,
  flashOff: 175,
  flashOn: 100,
  height: 47,
  heightDuck: 25,
  introDuration: 1500,
  speedDropCoefficient: 3,
  startXPos: 50,
  width: 44,
  widthDuck: 59,
};

const normalJumpConfig = {
  gravity: 0.6,
  maxJumpHeight: 30,
  minJumpHeight: 30,
  initialJumpVelocity: -10,
};

const trexConfig = { ...defaultTrexConfig, ...normalJumpConfig };

const BLINK_TIMING = 7000;

// Per-status animation: sequence of sprite names + ms-per-frame.
// Frame names match the original Chromium animFrames in trex.ts:
//   WAITING blinks between blink (44) and idle (0); JUMPING reuses idle (0).
const trexAnimFrames: Record<
  Status,
  { frames: SpriteName[]; msPerFrame: number }
> = {
  [Status.WAITING]: { frames: ['trexBlink', 'trexIdle'], msPerFrame: 1000 / 3 },
  [Status.RUNNING]: { frames: ['trexRun1', 'trexRun2'], msPerFrame: 1000 / 12 },
  [Status.CRASHED]: { frames: ['trexCrash'], msPerFrame: 1000 / 60 },
  [Status.JUMPING]: { frames: ['trexIdle'], msPerFrame: 1000 / 60 },
  [Status.DUCKING]: {
    frames: ['trexDuck1', 'trexDuck2'],
    msPerFrame: 1000 / 8,
  },
};

const trexCollisionBoxes = {
  ducking: [new CollisionBox(1, 18, 55, 25)],
  running: [
    new CollisionBox(22, 0, 17, 16),
    new CollisionBox(1, 18, 30, 9),
    new CollisionBox(10, 35, 14, 8),
    new CollisionBox(1, 24, 29, 5),
    new CollisionBox(5, 30, 21, 4),
    new CollisionBox(9, 34, 15, 4),
  ],
};

class Trex {
  config = trexConfig;
  xPos = 0;
  yPos = 0;
  xInitialPos = 0;
  groundYPos = 0;
  jumpCount = 0;
  ducking = false;
  blinkCount = 0;
  jumping = false;
  speedDrop = false;
  currentFrame = 0;
  currentAnimFrames: SpriteName[] = [];
  blinkDelay = 0;
  animStartTime = 0;
  timer = 0;
  msPerFrame = 1000 / FPS;
  status: Status = Status.WAITING;
  jumpVelocity = 0;
  reachedMinHeight = false;
  minJumpHeight: number;
  playingIntro = false;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private sheet: HTMLImageElement,
    private theme: SpriteTheme,
  ) {
    this.groundYPos = CANVAS.HEIGHT - this.config.height - 10;
    this.yPos = this.groundYPos;
    this.minJumpHeight = this.groundYPos - this.config.minJumpHeight;
    this.update(0, Status.WAITING);
  }

  setBlinkDelay() {
    this.blinkDelay = Math.ceil(Math.random() * BLINK_TIMING);
  }

  update(deltaTime: number, status?: Status) {
    this.timer += deltaTime;
    if (status !== undefined) {
      this.status = status;
      this.currentFrame = 0;
      this.msPerFrame = trexAnimFrames[status].msPerFrame;
      this.currentAnimFrames = trexAnimFrames[status].frames;
      if (status === Status.WAITING) {
        this.animStartTime = performance.now();
        this.setBlinkDelay();
      }
    }
    if (this.playingIntro && this.xPos < this.config.startXPos) {
      this.xPos += Math.round(
        (this.config.startXPos / this.config.introDuration) * deltaTime,
      );
      this.xInitialPos = this.xPos;
    }
    if (this.status === Status.WAITING) {
      this.blink(performance.now());
    } else {
      this.draw(this.currentAnimFrames[this.currentFrame]);
    }
    if (this.timer >= this.msPerFrame) {
      this.currentFrame =
        this.currentFrame === this.currentAnimFrames.length - 1
          ? 0
          : this.currentFrame + 1;
      this.timer = 0;
    }
    if (this.speedDrop && this.yPos === this.groundYPos) {
      this.speedDrop = false;
      this.setDuck(true);
    }
  }

  draw(spriteName: SpriteName) {
    if (!spriteName) return;
    drawSprite(
      this.ctx,
      this.sheet,
      this.theme,
      spriteName,
      Math.round(this.xPos),
      Math.round(this.yPos),
    );
  }

  blink(time: number) {
    const deltaTime = time - this.animStartTime;
    if (deltaTime >= this.blinkDelay) {
      this.draw(this.currentAnimFrames[this.currentFrame]);
      if (this.currentFrame === 1) {
        this.setBlinkDelay();
        this.animStartTime = time;
        this.blinkCount++;
      }
    }
  }

  startJump(speed: number) {
    if (!this.jumping) {
      this.update(0, Status.JUMPING);
      this.jumpVelocity = this.config.initialJumpVelocity - speed / 10;
      this.jumping = true;
      this.reachedMinHeight = false;
      this.speedDrop = false;
    }
  }

  endJump() {
    if (this.reachedMinHeight && this.jumpVelocity < this.config.dropVelocity) {
      this.jumpVelocity = this.config.dropVelocity;
    }
  }

  updateJump(deltaTime: number) {
    const msPerFrame = trexAnimFrames[this.status].msPerFrame;
    const framesElapsed = deltaTime / msPerFrame;
    if (this.speedDrop) {
      this.yPos += Math.round(
        this.jumpVelocity * this.config.speedDropCoefficient * framesElapsed,
      );
    } else {
      this.yPos += Math.round(this.jumpVelocity * framesElapsed);
    }
    this.jumpVelocity += this.config.gravity * framesElapsed;
    if (this.yPos < this.minJumpHeight || this.speedDrop) {
      this.reachedMinHeight = true;
    }
    if (this.yPos < this.config.maxJumpHeight || this.speedDrop) {
      this.endJump();
    }
    if (this.yPos > this.groundYPos) {
      this.reset();
      this.jumpCount++;
    }
  }

  setSpeedDrop() {
    this.speedDrop = true;
    this.jumpVelocity = 1;
  }

  setDuck(isDucking: boolean) {
    if (isDucking && this.status !== Status.DUCKING) {
      this.update(0, Status.DUCKING);
      this.ducking = true;
    } else if (this.status === Status.DUCKING) {
      this.update(0, Status.RUNNING);
      this.ducking = false;
    }
  }

  reset() {
    this.xPos = this.xInitialPos;
    this.yPos = this.groundYPos;
    this.jumpVelocity = 0;
    this.jumping = false;
    this.ducking = false;
    this.update(0, Status.RUNNING);
    this.speedDrop = false;
    this.jumpCount = 0;
  }

  getCollisionBoxes(): CollisionBox[] {
    return this.ducking
      ? trexCollisionBoxes.ducking
      : trexCollisionBoxes.running;
  }

  getBoundingBox(): CollisionBox {
    return new CollisionBox(
      this.xPos,
      this.yPos,
      this.ducking ? this.config.widthDuck : this.config.width,
      this.config.height,
    );
  }
}

// ── Cloud ────────────────────────────────────────────────────────────────

const cloudConfig = {
  HEIGHT: 14,
  MAX_CLOUD_GAP: 400,
  MAX_SKY_LEVEL: 30,
  MIN_CLOUD_GAP: 100,
  MIN_SKY_LEVEL: 71,
  WIDTH: 46,
};

class Cloud {
  xPos: number;
  yPos = 0;
  remove = false;
  gap: number;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private sheet: HTMLImageElement,
    private theme: SpriteTheme,
    containerWidth: number,
  ) {
    this.xPos = containerWidth;
    this.gap = getRandomNum(
      cloudConfig.MIN_CLOUD_GAP,
      cloudConfig.MAX_CLOUD_GAP,
    );
    this.yPos = getRandomNum(
      cloudConfig.MAX_SKY_LEVEL,
      cloudConfig.MIN_SKY_LEVEL,
    );
    this.draw();
  }

  draw() {
    drawSprite(
      this.ctx,
      this.sheet,
      this.theme,
      'cloud',
      Math.round(this.xPos),
      Math.round(this.yPos),
    );
  }

  update(speed: number) {
    if (!this.remove) {
      this.xPos -= Math.ceil(speed);
      this.draw();
      if (!this.isVisible()) this.remove = true;
    }
  }

  isVisible() {
    return this.xPos + cloudConfig.WIDTH > 0;
  }
}

// ── HorizonLine ──────────────────────────────────────────────────────────

class HorizonLine {
  xPos: [number, number];
  yPos: number;
  dimensions = { width: CANVAS.WIDTH, height: 12 };

  constructor(
    private ctx: CanvasRenderingContext2D,
    private sheet: HTMLImageElement,
    private theme: SpriteTheme,
  ) {
    this.xPos = [0, this.dimensions.width];
    this.yPos = CANVAS.GROUND_Y;
    this.draw();
  }

  draw() {
    drawSprite(
      this.ctx,
      this.sheet,
      this.theme,
      'horizon',
      Math.round(this.xPos[0]),
      this.yPos,
    );
    drawSprite(
      this.ctx,
      this.sheet,
      this.theme,
      'horizon',
      Math.round(this.xPos[1]),
      this.yPos,
    );
  }

  updateXPos(pos: number, increment: number) {
    const line1 = pos;
    const line2 = pos === 0 ? 1 : 0;
    this.xPos[line1] -= increment;
    this.xPos[line2] = this.xPos[line1] + this.dimensions.width;
    if (this.xPos[line1] <= -this.dimensions.width) {
      this.xPos[line1] += this.dimensions.width * 2;
      this.xPos[line2] = this.xPos[line1] - this.dimensions.width;
    }
  }

  update(deltaTime: number, speed: number) {
    const increment = Math.floor(speed * (FPS / 1000) * deltaTime);
    this.updateXPos(this.xPos[0] <= 0 ? 0 : 1, increment);
    this.draw();
  }

  reset() {
    this.xPos[0] = 0;
    this.xPos[1] = this.dimensions.width;
  }
}

// ── DistanceMeter (score) ───────────────────────────────────────────────

const meterConfig = {
  MAX_DISTANCE_UNITS: 5,
  ACHIEVEMENT_DISTANCE: 100,
  COEFFICIENT: 0.025,
  FLASH_DURATION: 1000 / 4,
  FLASH_ITERATIONS: 3,
};

class DistanceMeter {
  achievement = false;
  x = 0;
  y = 5;
  maxScore = 0;
  highScore: string = '0';
  digits: string[] = [];
  defaultString = '';
  flashTimer = 0;
  flashIterations = 0;
  maxScoreUnits = meterConfig.MAX_DISTANCE_UNITS;
  cellWidth = DIGITS.cellWidth;
  cellHeight = DIGITS.cellHeight;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private sheet: HTMLImageElement,
    private theme: SpriteTheme,
    canvasWidth: number,
  ) {
    this.x = canvasWidth - this.cellWidth * (this.maxScoreUnits + 1);
    let maxStr = '';
    for (let i = 0; i < this.maxScoreUnits; i++) {
      this.draw(i, 0, false);
      this.defaultString += '0';
      maxStr += '9';
    }
    this.maxScore = parseInt(maxStr, 10);
  }

  draw(digitPos: number, value: number, isHighScore: boolean) {
    const cw = this.cellWidth;
    const ch = this.cellHeight;
    const groupPos = this.theme.positions[DIGITS.group];
    const scale = this.theme.scale;
    const sourceX = groupPos.x + (DIGITS.frameX + cw * value) * scale;
    const sourceY = groupPos.y + DIGITS.frameY * scale;
    const targetX = digitPos * cw;
    const targetY = this.y;
    this.ctx.save();
    if (isHighScore) {
      const highScoreX = this.x - this.maxScoreUnits * 2 * cw;
      this.ctx.translate(highScoreX, this.y);
    } else {
      this.ctx.translate(this.x, this.y);
    }
    this.ctx.drawImage(
      this.sheet,
      sourceX,
      sourceY,
      cw * scale,
      ch * scale,
      targetX,
      targetY,
      cw,
      ch,
    );
    this.ctx.restore();
  }

  getActualDistance(distance: number): number {
    return distance ? Math.round(distance * meterConfig.COEFFICIENT) : 0;
  }

  update(deltaTime: number, distance: number): boolean {
    let paint = true;
    let playSound = false;
    if (!this.achievement) {
      const actual = this.getActualDistance(distance);
      if (actual > 0) {
        if (actual % meterConfig.ACHIEVEMENT_DISTANCE === 0) {
          this.achievement = true;
          this.flashTimer = 0;
          playSound = true;
        }
        const distanceStr = (this.defaultString + actual).slice(
          -this.maxScoreUnits,
        );
        this.digits = distanceStr.split('');
      } else {
        this.digits = this.defaultString.split('');
      }
    } else {
      if (this.flashIterations <= meterConfig.FLASH_ITERATIONS) {
        this.flashTimer += deltaTime;
        if (this.flashTimer < meterConfig.FLASH_DURATION) {
          paint = false;
        } else if (this.flashTimer > meterConfig.FLASH_DURATION * 2) {
          this.flashTimer = 0;
          this.flashIterations++;
        }
      } else {
        this.achievement = false;
        this.flashIterations = 0;
        this.flashTimer = 0;
      }
    }
    if (paint) {
      for (let i = this.digits.length - 1; i >= 0; i--) {
        this.draw(i, parseInt(this.digits[i], 10), false);
      }
    }
    this.drawHighScore();
    return playSound;
  }

  drawHighScore() {
    if (this.highScore.length > 0) {
      this.ctx.save();
      this.ctx.globalAlpha = 0.8;
      for (let i = this.highScore.length - 1; i >= 0; i--) {
        const ch = this.highScore[i];
        const v = parseInt(ch, 10);
        if (Number.isNaN(v)) continue;
        this.draw(i, v, true);
      }
      this.ctx.restore();
    }
  }

  setHighScore(distance: number) {
    const actual = this.getActualDistance(distance);
    this.highScore = (this.defaultString + actual).slice(-this.maxScoreUnits);
  }

  reset() {
    this.update(0, 0);
    this.achievement = false;
  }
}

// ── Obstacles ────────────────────────────────────────────────────────────

type ObstacleType = {
  type: 'cactusSmall' | 'cactusLarge' | 'pterodactyl';
  width: number;
  height: number;
  yPos: number | number[];
  multipleSpeed: number;
  minGap: number;
  minSpeed: number;
  collisionBoxes: CollisionBox[];
  numFrames?: number;
  frameRate?: number;
  speedOffset?: number;
  /** Sprite names for each animation frame. */
  spriteFrames: SpriteName[];
};

const obstacleTypes: ObstacleType[] = [
  {
    type: 'cactusSmall',
    width: 17,
    height: 35,
    yPos: 105,
    multipleSpeed: 4,
    minGap: 120,
    minSpeed: 0,
    collisionBoxes: [
      new CollisionBox(0, 7, 5, 27),
      new CollisionBox(4, 0, 6, 34),
      new CollisionBox(10, 4, 7, 14),
    ],
    spriteFrames: ['cactusSmall'],
  },
  {
    type: 'cactusLarge',
    width: 25,
    height: 50,
    yPos: 90,
    multipleSpeed: 7,
    minGap: 120,
    minSpeed: 0,
    collisionBoxes: [
      new CollisionBox(0, 12, 7, 38),
      new CollisionBox(8, 0, 7, 49),
      new CollisionBox(13, 10, 10, 38),
    ],
    spriteFrames: ['cactusLarge'],
  },
  {
    type: 'pterodactyl',
    width: 46,
    height: 40,
    yPos: [100, 75, 50],
    multipleSpeed: 999,
    minSpeed: 8.5,
    minGap: 150,
    collisionBoxes: [
      new CollisionBox(15, 15, 16, 5),
      new CollisionBox(18, 21, 24, 6),
      new CollisionBox(2, 14, 4, 3),
      new CollisionBox(6, 10, 4, 7),
      new CollisionBox(10, 8, 6, 9),
    ],
    numFrames: 2,
    frameRate: 1000 / 6,
    speedOffset: 0.8,
    spriteFrames: ['pterodactyl1', 'pterodactyl2'],
  },
];

const MAX_GAP_COEFFICIENT = 1.5;
const MAX_OBSTACLE_LENGTH = 3;

class Obstacle {
  collisionBoxes: CollisionBox[] = [];
  followingObstacleCreated = false;
  gap = 0;
  remove = false;
  size: number;
  width = 0;
  xPos: number;
  yPos = 0;
  speedOffset = 0;
  currentFrame = 0;
  timer = 0;

  constructor(
    private ctx: CanvasRenderingContext2D,
    public typeConfig: ObstacleType,
    private sheet: HTMLImageElement,
    private theme: SpriteTheme,
    canvasWidth: number,
    private gapCoefficient: number,
    speed: number,
    xOffset: number,
  ) {
    this.size = getRandomNum(1, MAX_OBSTACLE_LENGTH);
    this.xPos = canvasWidth + xOffset;
    this.cloneCollisionBoxes();
    if (this.size > 1 && this.typeConfig.multipleSpeed > speed) {
      this.size = 1;
    }
    this.width = this.typeConfig.width * this.size;
    if (Array.isArray(this.typeConfig.yPos)) {
      const yPosArr = this.typeConfig.yPos;
      this.yPos = yPosArr[getRandomNum(0, yPosArr.length - 1)];
    } else {
      this.yPos = this.typeConfig.yPos;
    }
    this.draw();
    if (this.size > 1) {
      this.collisionBoxes[1].width =
        this.width -
        this.collisionBoxes[0].width -
        this.collisionBoxes[2].width;
      this.collisionBoxes[2].x = this.width - this.collisionBoxes[2].width;
    }
    if (this.typeConfig.speedOffset) {
      this.speedOffset =
        Math.random() > 0.5
          ? this.typeConfig.speedOffset
          : -this.typeConfig.speedOffset;
    }
    this.gap = this.getGap(this.gapCoefficient, speed);
  }

  draw() {
    const name = this.typeConfig.spriteFrames[this.currentFrame];
    for (let i = 0; i < this.size; i++) {
      drawSprite(
        this.ctx,
        this.sheet,
        this.theme,
        name,
        Math.round(this.xPos + i * this.typeConfig.width),
        Math.round(this.yPos),
      );
    }
  }

  update(deltaTime: number, speed: number) {
    if (this.remove) return;
    if (this.typeConfig.speedOffset) speed += this.speedOffset;
    this.xPos -= Math.floor(((speed * FPS) / 1000) * deltaTime);
    if (this.typeConfig.numFrames && this.typeConfig.frameRate) {
      this.timer += deltaTime;
      if (this.timer >= this.typeConfig.frameRate) {
        this.currentFrame =
          this.currentFrame === this.typeConfig.numFrames - 1
            ? 0
            : this.currentFrame + 1;
        this.timer = 0;
      }
    }
    this.draw();
    if (!this.isVisible()) this.remove = true;
  }

  getGap(gapCoefficient: number, speed: number): number {
    const minGap = Math.round(
      this.width * speed + this.typeConfig.minGap * gapCoefficient,
    );
    const maxGap = Math.round(minGap * MAX_GAP_COEFFICIENT);
    return getRandomNum(minGap, maxGap);
  }

  isVisible() {
    return this.xPos + this.width > 0;
  }

  getBoundingBox(): CollisionBox {
    return new CollisionBox(
      this.xPos,
      this.yPos,
      this.width,
      this.typeConfig.height,
    );
  }

  private cloneCollisionBoxes() {
    const src = this.typeConfig.collisionBoxes;
    for (let i = src.length - 1; i >= 0; i--) {
      this.collisionBoxes[i] = new CollisionBox(
        src[i].x,
        src[i].y,
        src[i].width,
        src[i].height,
      );
    }
  }
}

// ── Horizon (manages clouds, horizon-line, obstacles) ───────────────────

const horizonConfig = {
  BG_CLOUD_SPEED: 0.2,
  CLOUD_FREQUENCY: 0.5,
  MAX_CLOUDS: 6,
  MAX_OBSTACLE_DUPLICATION: 2,
};

class Horizon {
  obstacles: Obstacle[] = [];
  obstacleHistory: string[] = [];
  clouds: Cloud[] = [];
  cloudFrequency = horizonConfig.CLOUD_FREQUENCY;
  cloudSpeed = horizonConfig.BG_CLOUD_SPEED;
  horizonLine: HorizonLine;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private sheet: HTMLImageElement,
    private theme: SpriteTheme,
    private canvasWidth: number,
    private gapCoefficient: number,
  ) {
    this.addCloud();
    this.horizonLine = new HorizonLine(ctx, sheet, theme);
  }

  update(deltaTime: number, currentSpeed: number, updateObstacles: boolean) {
    this.horizonLine.update(deltaTime, currentSpeed);
    this.updateClouds(deltaTime, currentSpeed);
    if (updateObstacles) this.updateObstacles(deltaTime, currentSpeed);
  }

  updateClouds(deltaTime: number, speed: number) {
    const elSpeed = (this.cloudSpeed / 1000) * deltaTime * speed;
    for (const c of this.clouds) c.update(elSpeed);
    const last = this.clouds[this.clouds.length - 1];
    if (
      this.clouds.length < horizonConfig.MAX_CLOUDS &&
      last &&
      this.canvasWidth - last.xPos > last.gap &&
      Math.random() < this.cloudFrequency
    ) {
      this.addCloud();
    } else if (this.clouds.length === 0) {
      this.addCloud();
    }
    this.clouds = this.clouds.filter((c) => !c.remove);
  }

  updateObstacles(deltaTime: number, currentSpeed: number) {
    for (const o of this.obstacles) o.update(deltaTime, currentSpeed);
    this.obstacles = this.obstacles.filter((o) => !o.remove);
    if (this.obstacles.length > 0) {
      const last = this.obstacles[this.obstacles.length - 1];
      if (
        last &&
        !last.followingObstacleCreated &&
        last.isVisible() &&
        last.xPos + last.width + last.gap < this.canvasWidth
      ) {
        this.addNewObstacle(currentSpeed);
        last.followingObstacleCreated = true;
      }
    } else {
      this.addNewObstacle(currentSpeed);
    }
  }

  addNewObstacle(currentSpeed: number) {
    const idx = getRandomNum(0, obstacleTypes.length - 1);
    const obstacleType = obstacleTypes[idx];
    if (
      this.duplicateObstacleCheck(obstacleType.type) ||
      currentSpeed < obstacleType.minSpeed
    ) {
      this.addNewObstacle(currentSpeed);
      return;
    }
    this.obstacles.push(
      new Obstacle(
        this.ctx,
        obstacleType,
        this.sheet,
        this.theme,
        this.canvasWidth,
        this.gapCoefficient,
        currentSpeed,
        obstacleType.width,
      ),
    );
    this.obstacleHistory.unshift(obstacleType.type);
    if (this.obstacleHistory.length > horizonConfig.MAX_OBSTACLE_DUPLICATION) {
      this.obstacleHistory.splice(horizonConfig.MAX_OBSTACLE_DUPLICATION);
    }
  }

  duplicateObstacleCheck(nextType: string): boolean {
    let dup = 0;
    for (const t of this.obstacleHistory) {
      dup = t === nextType ? dup + 1 : 0;
    }
    return dup >= horizonConfig.MAX_OBSTACLE_DUPLICATION;
  }

  addCloud() {
    this.clouds.push(
      new Cloud(this.ctx, this.sheet, this.theme, this.canvasWidth),
    );
  }

  reset() {
    this.obstacles = [];
    this.obstacleHistory = [];
    this.horizonLine.reset();
  }
}

// ── Game (Runner equivalent) ────────────────────────────────────────────

const runnerConfig = {
  ACCELERATION: 0.001,
  GAP_COEFFICIENT: 0.6,
  GRAVITY: 0.6,
  INITIAL_JUMP_VELOCITY: 12,
  MAX_SPEED: 13,
  MIN_JUMP_HEIGHT: 35,
  SPEED: 6,
  SPEED_DROP_COEFFICIENT: 3,
  CLEAR_TIME: 3000,
  INVERT_DISTANCE: 700,
  INVERT_FADE_DURATION: 12000,
};

const GameState = {
  WAITING: 'waiting',
  RUNNING: 'running',
  CRASHED: 'crashed',
} as const;
type GameState = (typeof GameState)[keyof typeof GameState];

export type GameCallbacks = {
  /** Toggles a CSS "inverted" class on the canvas wrapper for night mode. */
  onInvertChange?: (inverted: boolean) => void;
};

export class Game {
  private ctx: CanvasRenderingContext2D;
  private sheet: HTMLImageElement;
  private theme: SpriteTheme;
  private callbacks: GameCallbacks;

  private state: GameState = GameState.WAITING;
  private rafId: number | null = null;
  private lastTime = 0;
  private runningTime = 0;
  private currentSpeed = runnerConfig.SPEED;
  private distanceRan = 0;
  private highestScore = 0;
  private inverted = false;
  private invertTimer = 0;

  private trex: Trex;
  private horizon: Horizon;
  private distanceMeter: DistanceMeter;

  constructor(
    canvas: HTMLCanvasElement,
    sheet: HTMLImageElement,
    theme: SpriteTheme,
    callbacks: GameCallbacks = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('cous: 2d context unavailable');
    this.ctx = ctx;
    this.sheet = sheet;
    this.theme = theme;
    this.callbacks = callbacks;

    const stored = Number(localStorage.getItem('cous:highScore'));
    if (Number.isFinite(stored) && stored > 0) this.highestScore = stored;

    this.trex = new Trex(ctx, sheet, theme);
    this.horizon = new Horizon(
      ctx,
      sheet,
      theme,
      CANVAS.WIDTH,
      runnerConfig.GAP_COEFFICIENT,
    );
    this.distanceMeter = new DistanceMeter(ctx, sheet, theme, CANVAS.WIDTH);
    this.distanceMeter.setHighScore(this.highestScore);
    this.draw();
  }

  start() {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - this.lastTime, 50);
      this.lastTime = now;
      this.update(dt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  jump() {
    if (this.state === GameState.CRASHED) {
      this.restart();
      return;
    }
    if (this.state === GameState.WAITING) {
      this.state = GameState.RUNNING;
      this.trex.playingIntro = true;
    }
    if (!this.trex.jumping && !this.trex.ducking) {
      this.trex.startJump(this.currentSpeed);
    }
  }

  duck(active: boolean) {
    if (this.state !== GameState.RUNNING) return;
    if (active) {
      if (this.trex.jumping) {
        this.trex.setSpeedDrop();
      } else if (!this.trex.jumping && !this.trex.ducking) {
        this.trex.setDuck(true);
      }
    } else {
      if (this.trex.ducking) this.trex.setDuck(false);
    }
  }

  restart() {
    this.state = GameState.RUNNING;
    this.currentSpeed = runnerConfig.SPEED;
    this.runningTime = 0;
    this.distanceRan = 0;
    this.invertTimer = 0;
    this.setInverted(false);
    this.horizon.reset();
    this.trex.reset();
    this.distanceMeter.reset();
    this.distanceMeter.setHighScore(this.highestScore);
    this.lastTime = performance.now();
  }

  private update(dt: number) {
    this.runningTime += dt;
    const hasObstacles = this.runningTime > runnerConfig.CLEAR_TIME;

    if (this.state === GameState.WAITING) {
      this.draw();
      this.trex.update(dt);
      return;
    }

    if (this.state === GameState.RUNNING) {
      // Accelerate over time, capped.
      if (this.currentSpeed < runnerConfig.MAX_SPEED) {
        this.currentSpeed += runnerConfig.ACCELERATION;
      }

      this.draw();
      this.horizon.update(dt, this.currentSpeed, hasObstacles);

      if (hasObstacles && this.checkForCollision()) {
        this.gameOver();
      } else {
        this.distanceRan += (this.currentSpeed * dt) / (1000 / FPS);
        const playAch = this.distanceMeter.update(
          dt,
          Math.ceil(this.distanceRan),
        );
        if (playAch) {
          /* achievement reached — sound omitted */
        }

        // Night mode: every INVERT_DISTANCE points, flip palette for
        // INVERT_FADE_DURATION ms then revert.
        if (this.invertTimer > runnerConfig.INVERT_FADE_DURATION) {
          this.invertTimer = 0;
          this.setInverted(false);
        } else if (this.invertTimer) {
          this.invertTimer += dt;
        } else {
          const actual = this.distanceMeter.getActualDistance(
            Math.ceil(this.distanceRan),
          );
          if (actual > 0 && actual % runnerConfig.INVERT_DISTANCE === 0) {
            this.invertTimer += dt;
            this.setInverted(true);
          }
        }
      }

      // Update trex animation (jump physics, frame swaps).
      if (this.trex.jumping) this.trex.updateJump(dt);
      this.trex.update(dt);
    }

    if (this.state === GameState.CRASHED) {
      this.draw();
      this.trex.update(dt);
    }
  }

  private draw() {
    this.ctx.clearRect(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT);
    if (this.state === GameState.CRASHED) {
      const go = SPRITES.gameOver;
      const restart = SPRITES.restart;
      const cx = CANVAS.WIDTH / 2;
      drawSprite(
        this.ctx,
        this.sheet,
        this.theme,
        'gameOver',
        Math.round(cx - go.width / 2),
        30,
      );
      drawSprite(
        this.ctx,
        this.sheet,
        this.theme,
        'restart',
        Math.round(cx - restart.width / 2),
        50 + go.height,
      );
    }
  }

  private setInverted(value: boolean) {
    if (this.inverted === value) return;
    this.inverted = value;
    this.callbacks.onInvertChange?.(value);
  }

  private gameOver() {
    this.state = GameState.CRASHED;
    this.trex.update(100, Status.CRASHED);
    if (this.distanceRan > this.highestScore) {
      this.highestScore = Math.ceil(this.distanceRan);
      localStorage.setItem('cous:highScore', String(this.highestScore));
      this.distanceMeter.setHighScore(this.highestScore);
    }
  }

  // ── Collision detection ────────────────────────────────────────────────
  private checkForCollision(): boolean {
    const trexBox = this.trex.getBoundingBox();
    for (const obstacle of this.horizon.obstacles) {
      const obstacleBox = obstacle.getBoundingBox();
      if (boxIntersect(trexBox, obstacleBox)) {
        const trexBoxes = this.trex.getCollisionBoxes();
        const obstacleBoxes = obstacle.collisionBoxes;
        for (const tb of trexBoxes) {
          const adjTb = adjust(trexBox, tb);
          for (const ob of obstacleBoxes) {
            const adjOb = adjust(obstacleBox, ob);
            if (boxIntersect(adjTb, adjOb)) return true;
          }
        }
      }
    }
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getRandomNum(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function boxIntersect(a: CollisionBox, b: CollisionBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.height + a.y > b.y
  );
}

function adjust(parent: CollisionBox, local: CollisionBox): CollisionBox {
  return new CollisionBox(
    parent.x + local.x,
    parent.y + local.y,
    local.width,
    local.height,
  );
}
