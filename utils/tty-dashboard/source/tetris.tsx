/**
 * TETRIS GAME IN BRAILLE CHARACTERS
 *
 * This component renders a fully functional Tetris game using colored braille characters
 * for maximum space efficiency in a CLI environment.
 *
 * RENDERING STRATEGY:
 * - Uses Unicode braille characters (U+2800 to U+28FF) for compact rendering
 * - Each braille character can represent up to 8 dots in a 2x4 grid
 * - Color strategy: If a cell contains only one tetromino, use that color
 *   If a cell is shared by multiple tetrominos, use the average color
 *
 * FEATURES:
 * - Complete Tetris gameplay: piece movement, rotation, line clearing, collision detection
 * - Auto-playing AI agent that plays in the background
 * - Compact rendering suitable for corner display in CLI dashboards
 *
 * TETROMINO TYPES:
 * I (cyan), O (yellow), T (purple), S (green), Z (red), J (blue), L (orange)
 */
/** biome-ignore-all lint/style/noNonNullAssertion: forgive the AI */

import { Box, Text } from 'ink';
import { type FC, useEffect, useState } from 'react';

// Tetromino shapes (4x4 grid, 1 = filled)
const SHAPES = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ],
  T: [
    [0, 0, 0, 0],
    [0, 1, 1, 1],
    [0, 0, 1, 0],
    [0, 0, 0, 0],
  ],
  S: [
    [0, 0, 0, 0],
    [0, 0, 1, 1],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ],
  Z: [
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 0, 1, 1],
    [0, 0, 0, 0],
  ],
  J: [
    [0, 0, 0, 0],
    [0, 1, 1, 1],
    [0, 0, 0, 1],
    [0, 0, 0, 0],
  ],
  L: [
    [0, 0, 0, 0],
    [0, 1, 1, 1],
    [0, 1, 0, 0],
    [0, 0, 0, 0],
  ],
} as const;

type TetrominoType = keyof typeof SHAPES;

const COLORS: Record<TetrominoType, { r: number; g: number; b: number }> = {
  I: { r: 0, g: 255, b: 255 }, // cyan
  O: { r: 255, g: 255, b: 0 }, // yellow
  T: { r: 200, g: 100, b: 255 }, // bright purple
  S: { r: 100, g: 255, b: 100 }, // bright green
  Z: { r: 255, g: 80, b: 80 }, // bright red
  J: { r: 100, g: 150, b: 255 }, // bright blue
  L: { r: 255, g: 200, b: 0 }, // bright orange
};

const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;

interface Cell {
  type: TetrominoType | null;
}

interface Piece {
  type: TetrominoType;
  x: number;
  y: number;
  rotation: number;
}

// Rotate a shape 90 degrees clockwise
function rotateShape(shape: readonly (readonly number[])[]): number[][] {
  const n = shape.length;
  const rotated: number[][] = Array(n)
    .fill(0)
    .map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      rotated[j]![n - 1 - i] = shape[i]![j]!;
    }
  }
  return rotated;
}

// Get rotated shape
function getRotatedShape(type: TetrominoType, rotation: number): number[][] {
  let shape: number[][] | readonly (readonly number[])[] = SHAPES[type];
  for (let i = 0; i < rotation; i++) {
    shape = rotateShape(shape);
  }
  return shape as number[][];
}

// Check collision
function checkCollision(
  board: Cell[][],
  piece: Piece,
  offsetX = 0,
  offsetY = 0,
): boolean {
  const shape = getRotatedShape(piece.type, piece.rotation);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (shape[y]?.[x]) {
        const newX = piece.x + x + offsetX;
        const newY = piece.y + y + offsetY;
        if (
          newX < 0 ||
          newX >= BOARD_WIDTH ||
          newY >= BOARD_HEIGHT ||
          (newY >= 0 && board[newY]?.[newX]?.type !== null)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

// Merge piece into board
function mergePiece(board: Cell[][], piece: Piece): Cell[][] {
  const newBoard = board.map((row) => [...row]);
  const shape = getRotatedShape(piece.type, piece.rotation);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (shape[y]?.[x] && piece.y + y >= 0 && newBoard[piece.y + y]) {
        newBoard[piece.y + y]![piece.x + x] = { type: piece.type };
      }
    }
  }
  return newBoard;
}

// Clear completed lines
function clearLines(board: Cell[][]): {
  board: Cell[][];
  linesCleared: number;
} {
  let linesCleared = 0;
  const newBoard = board.filter((row) => {
    if (row.every((cell) => cell.type !== null)) {
      linesCleared++;
      return false;
    }
    return true;
  });

  while (newBoard.length < BOARD_HEIGHT) {
    newBoard.unshift(
      Array(BOARD_WIDTH)
        .fill(null)
        .map(() => ({ type: null })),
    );
  }

  return { board: newBoard, linesCleared };
}

// Get random tetromino
function getRandomTetromino(): TetrominoType {
  const types = Object.keys(SHAPES) as TetrominoType[];
  return types[Math.floor(Math.random() * types.length)]!;
}

// AI: Find best position for current piece
function findBestMove(
  board: Cell[][],
  piece: Piece,
): { x: number; rotation: number } {
  let bestScore = -Infinity;
  let bestX = piece.x;
  let bestRotation = 0;

  for (let rotation = 0; rotation < 4; rotation++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const testPiece = { ...piece, x, rotation };
      if (!checkCollision(board, testPiece)) {
        // Drop piece down
        let dropY = testPiece.y;
        while (!checkCollision(board, { ...testPiece, y: dropY + 1 })) {
          dropY++;
        }
        const droppedPiece = { ...testPiece, y: dropY };
        const testBoard = mergePiece(board, droppedPiece);
        const score = evaluateBoard(testBoard);

        if (score > bestScore) {
          bestScore = score;
          bestX = x;
          bestRotation = rotation;
        }
      }
    }
  }

  return { x: bestX, rotation: bestRotation };
}

// Evaluate board state (simple heuristic)
function evaluateBoard(board: Cell[][]): number {
  let score = 0;
  let aggregateHeight = 0;
  let completeLines = 0;
  let holes = 0;
  let bumpiness = 0;

  const columnHeights: number[] = [];

  for (let x = 0; x < BOARD_WIDTH; x++) {
    let columnHeight = 0;
    let foundBlock = false;

    for (let y = 0; y < BOARD_HEIGHT; y++) {
      if (board[y]?.[x]?.type !== null) {
        if (!foundBlock) {
          columnHeight = BOARD_HEIGHT - y;
          foundBlock = true;
        }
      } else if (foundBlock) {
        holes++;
      }
    }

    columnHeights.push(columnHeight);
    aggregateHeight += columnHeight;
  }

  // Calculate bumpiness
  for (let i = 0; i < columnHeights.length - 1; i++) {
    bumpiness += Math.abs(columnHeights[i]! - columnHeights[i + 1]!);
  }

  // Count complete lines
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    if (board[y]!.every((cell) => cell.type !== null)) {
      completeLines++;
    }
  }

  // Scoring weights
  score -= aggregateHeight * 0.5;
  score += completeLines * 10;
  score -= holes * 3;
  score -= bumpiness * 0.2;

  return score;
}

// Convert board to braille representation
function renderBraille(board: Cell[][], currentPiece: Piece | null): string[] {
  // Create a combined view with current piece
  const displayBoard = board.map((row) => [...row]);

  if (currentPiece) {
    const shape = getRotatedShape(currentPiece.type, currentPiece.rotation);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (
          shape[y]![x] &&
          currentPiece.y + y >= 0 &&
          currentPiece.y + y < BOARD_HEIGHT
        ) {
          displayBoard[currentPiece.y + y]![currentPiece.x + x] = {
            type: currentPiece.type,
          };
        }
      }
    }
  }

  // Braille rendering: each braille char = 2x4 dots
  const lines: string[] = [];
  const brailleDots = [0x1, 0x2, 0x4, 0x40, 0x8, 0x10, 0x20, 0x80];

  // Extend by 1 column on each side for borders
  const renderWidth = BOARD_WIDTH + 2; // +1 for left border, +1 for right border
  const renderHeight = BOARD_HEIGHT; // No extra row needed, bottom border fits in last pixels

  for (let y = 0; y < renderHeight; y += 4) {
    let line = '';
    for (let x = 0; x < renderWidth; x += 2) {
      let brailleCode = 0x2800;
      const colors: { r: number; g: number; b: number }[] = [];

      // Map 2x4 grid to braille dots
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const renderY = y + dy;
          const renderX = x + dx;
          const dotIndex = dx * 4 + dy;

          // Convert render coordinates to board coordinates (offset by 1 for left border)
          const boardY = renderY;
          const boardX = renderX - 1;

          // Check if this is a border pixel
          const isTopBorder =
            renderY === 0 && renderX >= 1 && renderX <= BOARD_WIDTH;
          const isBottomBorder =
            renderY === BOARD_HEIGHT && renderX >= 1 && renderX <= BOARD_WIDTH;
          const isLeftBorder = renderX === 0 && renderY < BOARD_HEIGHT;
          const isRightBorder =
            renderX === BOARD_WIDTH + 1 && renderY < BOARD_HEIGHT;
          const isBorder =
            isTopBorder || isBottomBorder || isLeftBorder || isRightBorder;

          if (isBorder) {
            // Add white border pixel
            brailleCode |= brailleDots[dotIndex]!;
            colors.push({ r: 255, g: 255, b: 255 });
          } else if (
            boardY >= 0 &&
            boardY < BOARD_HEIGHT &&
            boardX >= 0 &&
            boardX < BOARD_WIDTH
          ) {
            // Inside game area
            const cell = displayBoard[boardY]?.[boardX];
            if (cell?.type) {
              brailleCode |= brailleDots[dotIndex]!;
              colors.push(COLORS[cell.type]);
            }
          }
        }
      }

      // Calculate average color
      let color = '';
      if (colors.length > 0) {
        const avgR = Math.round(
          colors.reduce((s, c) => s + c.r, 0) / colors.length,
        );
        const avgG = Math.round(
          colors.reduce((s, c) => s + c.g, 0) / colors.length,
        );
        const avgB = Math.round(
          colors.reduce((s, c) => s + c.b, 0) / colors.length,
        );
        color = `\x1b[38;2;${avgR};${avgG};${avgB}m`;
      }

      line +=
        color + String.fromCharCode(brailleCode) + (color ? '\x1b[0m' : '');
    }
    lines.push(line);
  }

  return lines;
}

interface TetrisProps {
  millisecondsPerFrame?: number;
}

export const Tetris: FC<TetrisProps> = ({ millisecondsPerFrame = 500 }) => {
  const [board, setBoard] = useState<Cell[][]>(
    Array(BOARD_HEIGHT)
      .fill(null)
      .map(() =>
        Array(BOARD_WIDTH)
          .fill(null)
          .map(() => ({ type: null })),
      ),
  );
  const [currentPiece, setCurrentPiece] = useState<Piece | null>(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  // Initialize first piece
  useEffect(() => {
    setCurrentPiece({
      type: getRandomTetromino(),
      x: 3,
      y: 0,
      rotation: 0,
    });
  }, []);

  // Game loop
  useEffect(() => {
    if (gameOver || !currentPiece) return;

    const interval = setInterval(() => {
      // AI makes decision
      const { x: targetX, rotation: targetRotation } = findBestMove(
        board,
        currentPiece,
      );

      // Move/rotate towards target
      const newPiece = { ...currentPiece };

      // Rotate if needed
      if (newPiece.rotation !== targetRotation) {
        const testRotation = (newPiece.rotation + 1) % 4;
        if (!checkCollision(board, { ...newPiece, rotation: testRotation })) {
          newPiece.rotation = testRotation;
        }
      }

      // Move horizontally towards target
      if (newPiece.x < targetX) {
        if (!checkCollision(board, newPiece, 1, 0)) {
          newPiece.x++;
        }
      } else if (newPiece.x > targetX) {
        if (!checkCollision(board, newPiece, -1, 0)) {
          newPiece.x--;
        }
      }

      // Move down
      if (!checkCollision(board, newPiece, 0, 1)) {
        newPiece.y++;
        setCurrentPiece(newPiece);
      } else {
        // Lock piece
        const newBoard = mergePiece(board, newPiece);
        const { board: clearedBoard, linesCleared } = clearLines(newBoard);
        setBoard(clearedBoard);
        setScore((s) => s + linesCleared * 100);

        // Spawn new piece
        const nextPiece: Piece = {
          type: getRandomTetromino(),
          x: 3,
          y: 0,
          rotation: 0,
        };

        if (checkCollision(clearedBoard, nextPiece)) {
          setGameOver(true);
          // Restart after 3 seconds
          setTimeout(() => {
            setBoard(
              Array(BOARD_HEIGHT)
                .fill(null)
                .map(() =>
                  Array(BOARD_WIDTH)
                    .fill(null)
                    .map(() => ({ type: null })),
                ),
            );
            setScore(0);
            setGameOver(false);
            setCurrentPiece(nextPiece);
          }, 3000);
        } else {
          setCurrentPiece(nextPiece);
        }
      }
    }, millisecondsPerFrame);

    return () => clearInterval(interval);
  }, [board, currentPiece, gameOver]);

  const lines = renderBraille(board, currentPiece);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column">
        {lines.map((line) => (
          <Text bold key={line}>
            {line}
          </Text>
        ))}
      </Box>
      <Text dimColor>Score: {score}</Text>
      <Text color="red">{gameOver ? 'GAME OVER!' : ' '}</Text>
    </Box>
  );
};
