import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const {
  buildCustomPosition,
  indexToSquare,
  makeGamePayload,
  movesMatch,
  randomizeCustomPieces,
  squareToIndex,
  validateCustomPieces,
} = await import(moduleUrl);

// Verify the client uses the same square indexing as the Python board.
assert.equal(squareToIndex("a8"), 0);
assert.equal(squareToIndex("e2"), 52);
assert.equal(squareToIndex("h1"), 63);
assert.equal(indexToSquare(0), "a8");
assert.equal(indexToSquare(52), "e2");
assert.equal(indexToSquare(63), "h1");

// Verify each request gets the exact start and complete move history.
const moves = [{ from: "e2", to: "e4" }];
const payload = makeGamePayload({ type: "standard" }, moves);
assert.deepEqual(payload, { start_position: { type: "standard" }, moves });
assert.notEqual(payload.moves, moves);

// Distinguish promotions while matching ordinary move coordinates.
assert.equal(movesMatch({ from: "a7", to: "a8", promotion: "Q" }, { from: "a7", to: "a8", promotion: "Q" }), true);
assert.equal(movesMatch({ from: "a7", to: "a8", promotion: "Q" }, { from: "a7", to: "a8", promotion: "N" }), false);

// Verify a hand-built position uses the API's custom start format.
const customPieces = [
  { type: "king", color: "white", square: "e1", first_move: true },
  { type: "king", color: "black", square: "e8", first_move: true },
  { type: "queen", color: "white", square: "d4", first_move: false },
];
assert.equal(validateCustomPieces(customPieces), "");
assert.deepEqual(buildCustomPosition(customPieces), {
  type: "custom",
  turn: "white",
  pieces: customPieces,
});
assert.match(validateCustomPieces([
  { ...customPieces[0], square: "a1" },
  customPieces[2],
]), /king for each side/);
assert.match(validateCustomPieces([
  ...customPieces,
  { type: "pawn", color: "black", square: "h8", first_move: false },
]), /Pawns cannot start/);

// Verify random placement keeps unique squares, both kings, and pawns off edge ranks.
const randomCounts = {
  white: { king: 1, queen: 1, bishop: 0, knight: 1, rook: 0, pawn: 3 },
  black: { king: 1, queen: 0, bishop: 1, knight: 0, rook: 1, pawn: 2 },
};
const randomPieces = randomizeCustomPieces(randomCounts, () => 0.5);
assert.equal(validateCustomPieces(randomPieces), "");
assert.equal(randomPieces.length, 11);
assert.equal(new Set(randomPieces.map((piece) => piece.square)).size, randomPieces.length);

console.log("Web logic tests passed.");
