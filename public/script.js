const FILES = "abcdefgh";
const PROMOTION_TYPES = [
  { code: "Q", name: "queen" },
  { code: "R", name: "rook" },
  { code: "B", name: "bishop" },
  { code: "N", name: "knight" },
];
const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const MAX_DEPTH = 8;
const MAX_MCTS_ITERATIONS = 500;
const CUSTOM_PIECE_TYPES = ["king", "queen", "bishop", "knight", "rook", "pawn"];
const CUSTOM_PIECE_LIMITS = { king: 1, queen: 1, bishop: 2, knight: 2, rook: 2, pawn: 8 };
const PRACTICE_LEVELS = {
  gentle: { depth: 1, iterations: 25 },
  club: { depth: 2, iterations: 100 },
  strong: { depth: 4, iterations: 300 },
};

// Convert an algebraic square to the engine's row-major board index.
export function squareToIndex(square) {
  return (8 - Number(square[1])) * 8 + FILES.indexOf(square[0]);
}

// Convert a row-major board index to algebraic notation.
export function indexToSquare(index) {
  return FILES[index % 8] + String(8 - Math.floor(index / 8));
}

// Build the full replay payload required by every stateless game endpoint.
export function makeGamePayload(startPosition, moves) {
  return { start_position: startPosition, moves: [...moves] };
}

// Compare move identity, including promotion choice.
export function movesMatch(first, second) {
  return first.from === second.from && first.to === second.to && (first.promotion || "") === (second.promotion || "");
}

// Check the custom placement against the API's starting-position rules.
export function validateCustomPieces(pieces) {
  if (!Array.isArray(pieces) || pieces.length < 2 || pieces.length > 32) {
    return "A custom board needs 2 to 32 pieces.";
  }
  const kings = { white: 0, black: 0 };
  const squares = new Set();
  for (const piece of pieces) {
    if (!CUSTOM_PIECE_TYPES.includes(piece.type) || !["white", "black"].includes(piece.color)) {
      return "Each piece needs a valid color and type.";
    }
    if (!/^[a-h][1-8]$/.test(piece.square) || typeof piece.first_move !== "boolean") {
      return "Each piece needs a square and a valid move flag.";
    }
    if (squares.has(piece.square)) return "Only one piece can occupy a square.";
    squares.add(piece.square);
    if (piece.type === "king") kings[piece.color] += 1;
    if (piece.type === "pawn" && ["1", "8"].includes(piece.square[1])) {
      return "Pawns cannot start on the first or eighth rank.";
    }
  }
  if (kings.white !== 1 || kings.black !== 1) return "Place exactly one king for each side.";
  return "";
}

// Build the documented custom start-position payload from the board editor.
export function buildCustomPosition(pieces) {
  return {
    type: "custom",
    turn: "white",
    pieces: pieces.map(({ type, color, square, first_move }) => ({ type, color, square, first_move })),
  };
}

// Generate a random custom layout while respecting piece-count and pawn-rank limits.
export function randomizeCustomPieces(counts, randomValue = Math.random) {
  const pieces = [];
  for (const color of ["white", "black"]) {
    for (const type of CUSTOM_PIECE_TYPES) {
      const count = counts[color][type];
      const minimum = type === "king" ? 1 : 0;
      if (!Number.isInteger(count) || count < minimum || count > CUSTOM_PIECE_LIMITS[type]) {
        throw new Error(`Invalid ${color} ${type} count.`);
      }
      for (let index = 0; index < count; index += 1) pieces.push({ type, color });
    }
  }
  if (pieces.length > 32) throw new Error("A custom board supports up to 32 pieces.");

  const openSquares = Array.from({ length: 64 }, (_, index) => index);
  const placement = [];
  for (const piece of pieces) {
    const candidates = piece.type === "pawn"
      ? openSquares.filter((index) => index >= 8 && index < 56)
      : openSquares;
    if (!candidates.length) throw new Error("There are not enough valid squares for these pieces.");
    const choice = Math.min(candidates.length - 1, Math.floor(randomValue() * candidates.length));
    const boardIndex = candidates[choice];
    openSquares.splice(openSquares.indexOf(boardIndex), 1);
    const square = indexToSquare(boardIndex);
    placement.push({
      ...piece,
      square,
      first_move: hasFirstMoveRight(piece.type, piece.color, square),
    });
  }
  return placement;
}

// Give a home-square king or rook its initial castling right.
function hasFirstMoveRight(type, color, square) {
  const homeRank = color === "white" ? "1" : "8";
  if (type === "king") return square === `e${homeRank}`;
  return type === "rook" && [`a${homeRank}`, `h${homeRank}`].includes(square);
}

// Create the fresh editor board used when Custom is first selected.
function makeDefaultCustomPieces() {
  return [
    { type: "king", color: "white", square: "e1", first_move: true },
    { type: "king", color: "black", square: "e8", first_move: true },
  ];
}

// Create desktop-matching piece counts for the random placement editor.
function makeDefaultRandomCounts() {
  return {
    white: { king: 1, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 },
    black: { king: 1, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 },
  };
}

// Start the page only in a browser, leaving the pure helpers importable in Node.
if (typeof document !== "undefined") {
  initializePage();
}

// Bind the page controls and create the one client-owned game state object.
function initializePage() {
  const elements = getElements();
  const gameState = {
    startPosition: { type: "standard" },
    moves: [],
    legalMoves: [],
    game: { status: "ongoing", draw_reason: null },
    positionType: "standard",
    customPieces: makeDefaultCustomPieces(),
    customMethod: "manual",
    customPieceColor: "white",
    customPieceType: "queen",
    customTool: "piece",
    customMessage: "",
    randomCounts: makeDefaultRandomCounts(),
    mode: "human",
    practiceLevel: "gentle",
    coachHint: null,
    coachNote: "",
    coachLoading: false,
    algorithms: { white: "alphabeta", black: "alphabeta" },
    depth: 2,
    iterations: 100,
    selectedSquare: null,
    pendingPromotion: null,
    lastAi: null,
    auto: false,
    loading: false,
    aiPaused: false,
    error: "",
    retryTask: null,
    started: false,
  };

  bindEvents(gameState, elements);
  updateSetupVisibility(gameState, elements);
  renderCustomEditor(gameState, elements);
  render(gameState, elements);
}

// Collect the page elements once so rendering functions receive a clear view of the UI.
function getElements() {
  return {
    setupScreen: document.querySelector("#setup-screen"),
    setupForm: document.querySelector("#setup-form"),
    gameMode: document.querySelector("#game-mode"),
    practiceLevelField: document.querySelector("#practice-level-field"),
    practiceLevel: document.querySelector("#practice-level"),
    startPosition: document.querySelector("#start-position"),
    customEditor: document.querySelector("#custom-editor"),
    customBoard: document.querySelector("#custom-board"),
    customBoardMessage: document.querySelector("#custom-board-message"),
    customMethod: document.querySelector("#custom-method"),
    manualTools: document.querySelector("#manual-tools"),
    randomTools: document.querySelector("#random-tools"),
    customPieceColor: document.querySelector("#custom-piece-color"),
    customPiecePalette: document.querySelector("#custom-piece-palette"),
    customErase: document.querySelector("#custom-erase"),
    customToolHint: document.querySelector("#custom-tool-hint"),
    customReset: document.querySelector("#custom-reset"),
    randomCounts: document.querySelector("#random-counts"),
    randomCountSummary: document.querySelector("#random-count-summary"),
    randomizeBoard: document.querySelector("#randomize-board"),
    humanAlgorithm: document.querySelector("#human-algorithm"),
    whiteAlgorithm: document.querySelector("#white-algorithm"),
    blackAlgorithm: document.querySelector("#black-algorithm"),
    depthInput: document.querySelector("#search-depth"),
    iterationInput: document.querySelector("#mcts-iterations"),
    humanAlgorithmField: document.querySelector("#human-algorithm-field"),
    aiAlgorithms: document.querySelector("#ai-algorithms"),
    gameScreen: document.querySelector("#game-screen"),
    board: document.querySelector("#chess-board"),
    boardWrap: document.querySelector("#board-wrap"),
    turnIndicator: document.querySelector("#turn-indicator"),
    gameStatus: document.querySelector("#game-status"),
    loading: document.querySelector("#loading-indicator"),
    loadingMessage: document.querySelector("#loading-message"),
    error: document.querySelector("#error-message"),
    errorText: document.querySelector("#error-text"),
    retry: document.querySelector("#retry-button"),
    setupError: document.querySelector("#setup-error-message"),
    setupErrorText: document.querySelector("#setup-error-text"),
    setupRetry: document.querySelector("#setup-retry-button"),
    modeSummary: document.querySelector("#mode-summary"),
    algorithmSummary: document.querySelector("#algorithm-summary"),
    humanControls: document.querySelector("#human-controls"),
    aiControls: document.querySelector("#ai-controls"),
    humanRunAi: document.querySelector("#human-run-ai"),
    coachHint: document.querySelector("#coach-hint-button"),
    coachNote: document.querySelector("#coach-note"),
    runAi: document.querySelector("#run-ai-button"),
    auto: document.querySelector("#auto-button"),
    undo: document.querySelector("#undo-button"),
    lastAi: document.querySelector("#last-ai-result"),
    newGame: document.querySelector("#new-game-button"),
    back: document.querySelector("#back-button"),
    promotion: document.querySelector("#promotion-picker"),
    promotionOptions: document.querySelector("#promotion-options"),
    cancelPromotion: document.querySelector("#cancel-promotion"),
  };
}

// Attach keyboard-accessible form and board actions to the page.
function bindEvents(state, elements) {
  // Refresh the setup fields after switching the game mode.
  elements.gameMode.addEventListener("change", () => updateSetupVisibility(state, elements));
  // Keep the selected practice strength in the page's single state object.
  elements.practiceLevel.addEventListener("change", () => {
    state.practiceLevel = elements.practiceLevel.value;
  });
  // Show or hide the custom-board editor when the starting position changes.
  elements.startPosition.addEventListener("change", () => {
    state.positionType = elements.startPosition.value;
    state.customMessage = "";
    updateSetupVisibility(state, elements);
    renderCustomEditor(state, elements);
  });
  // Validate and submit the setup values when the form is sent.
  elements.setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startGameFromForm(state, elements);
  });
  // Pass board clicks to the current move-selection rules.
  elements.board.addEventListener("click", (event) => handleBoardClick(event, state, elements));
  // Retry failed requests from either error panel.
  elements.retry.addEventListener("click", () => retryLastRequest(state, elements));
  elements.setupRetry.addEventListener("click", () => retryLastRequest(state, elements));
  // Let a paused human game or AI game advance one turn.
  elements.humanRunAi.addEventListener("click", () => runAiTurn(state, elements));
  // Ask the same engine for a suggestion without making the move.
  elements.coachHint.addEventListener("click", () => requestCoachHint(state, elements));
  elements.runAi.addEventListener("click", () => runAiTurn(state, elements));
  // Toggle the AI-versus-AI autoplay loop.
  elements.auto.addEventListener("click", () => toggleAutoPlay(state, elements));
  // Attach navigation, undo, and promotion picker actions.
  elements.undo.addEventListener("click", () => undoLastTurn(state, elements));
  elements.newGame.addEventListener("click", () => startNewGame(state, elements, state.startPosition));
  elements.back.addEventListener("click", () => showSetup(state, elements));
  elements.cancelPromotion.addEventListener("click", () => closePromotionPicker(state, elements));
  elements.promotionOptions.addEventListener("click", (event) => choosePromotion(event, state, elements));
  // Change the selected piece without changing the board.
  elements.customPieceColor.addEventListener("change", () => {
    state.customPieceColor = elements.customPieceColor.value;
    state.customTool = "piece";
    renderCustomEditor(state, elements);
  });
  elements.customPiecePalette.addEventListener("click", (event) => chooseCustomPiece(event, state, elements));
  elements.customMethod.addEventListener("click", (event) => chooseCustomMethod(event, state, elements));
  elements.customErase.addEventListener("click", () => selectEraseTool(state, elements));
  elements.customBoard.addEventListener("click", (event) => placeCustomPiece(event, state, elements));
  elements.customReset.addEventListener("click", () => resetCustomBoard(state, elements));
  elements.randomCounts.addEventListener("click", (event) => adjustRandomCount(event, state, elements));
  elements.randomizeBoard.addEventListener("click", () => randomizeBoard(state, elements));
}

// Show the algorithm fields that match the selected game mode.
function updateSetupVisibility(state, elements) {
  const isAiGame = elements.gameMode.value === "ai";
  const isPractice = elements.gameMode.value === "practice";
  elements.humanAlgorithmField.hidden = isAiGame;
  elements.aiAlgorithms.hidden = !isAiGame;
  elements.practiceLevelField.hidden = !isPractice;
  elements.startPosition.value = state.positionType;
  elements.customEditor.hidden = state.positionType !== "custom";
  elements.setupForm.classList.toggle("has-custom-board", state.positionType === "custom");
}

// Render the custom board, piece palette, and random-count controls from state.
function renderCustomEditor(state, elements) {
  const board = Array(64).fill(null);
  for (const piece of state.customPieces) {
    const symbol = { king: "k", queen: "q", rook: "r", bishop: "b", knight: "n", pawn: "p" }[piece.type];
    board[squareToIndex(piece.square)] = piece.color === "white" ? symbol.toUpperCase() : symbol;
  }
  const squares = board.map((piece, index) => {
    const square = indexToSquare(index);
    const button = document.createElement("button");
    const isLight = (Math.floor(index / 8) + index % 8) % 2 === 1;
    button.className = `square ${isLight ? "light" : "dark"} editor-target`;
    button.type = "button";
    button.dataset.square = square;
    button.setAttribute("role", "gridcell");
    const pieceDescription = piece
      ? `${piece === piece.toUpperCase() ? "White" : "Black"} ${PIECE_NAMES[piece.toLowerCase()]}`
      : "empty";
    const toolDescription = state.customTool === "erase"
      ? "remove piece"
      : `place ${state.customPieceColor} ${state.customPieceType}`;
    button.setAttribute("aria-label", `${square}, ${pieceDescription}; ${toolDescription}`);
    if (piece) {
      const image = document.createElement("img");
      image.src = `./img/${piece === piece.toUpperCase() ? "w" : "b"}_${PIECE_NAMES[piece.toLowerCase()]}.png`;
      image.alt = "";
      button.append(image);
    }
    return button;
  });
  elements.customBoard.replaceChildren(...squares);
  elements.customBoardMessage.textContent = state.customMessage;
  elements.customPieceColor.value = state.customPieceColor;
  elements.customErase.setAttribute("aria-pressed", String(state.customTool === "erase"));
  elements.customToolHint.textContent = state.customTool === "erase"
    ? "Select a square to remove its piece."
    : `Choose a ${state.customPieceColor} ${state.customPieceType}, then select a square.`;
  elements.manualTools.hidden = state.customMethod !== "manual";
  elements.randomTools.hidden = state.customMethod !== "random";
  for (const button of elements.customMethod.querySelectorAll("[data-custom-method]")) {
    button.setAttribute("aria-pressed", String(button.dataset.customMethod === state.customMethod));
  }
  renderCustomPalette(state, elements);
  renderRandomCounts(state, elements);
}

// Draw the six piece choices for the selected color.
function renderCustomPalette(state, elements) {
  const choices = CUSTOM_PIECE_TYPES.map((type) => {
    const button = document.createElement("button");
    const colorPrefix = state.customPieceColor === "white" ? "w" : "b";
    button.className = "piece-choice";
    button.type = "button";
    button.dataset.pieceType = type;
    button.setAttribute("aria-label", `Select ${state.customPieceColor} ${type}`);
    button.setAttribute("aria-pressed", String(state.customTool === "piece" && state.customPieceType === type));
    const image = document.createElement("img");
    image.src = `./img/${colorPrefix}_${type}.png`;
    image.alt = "";
    button.append(image);
    return button;
  });
  elements.customPiecePalette.replaceChildren(...choices);
}

// Render the desktop-style piece counts used by random board generation.
function renderRandomCounts(state, elements) {
  const activeKey = document.activeElement?.dataset?.countKey;
  const groups = ["white", "black"].map((color) => {
    const group = document.createElement("section");
    group.className = "custom-count-side";
    const heading = document.createElement("h3");
    heading.textContent = color === "white" ? "White pieces · 1 king" : "Black pieces · 1 king";
    group.append(heading);
    for (const type of CUSTOM_PIECE_TYPES.filter((pieceType) => pieceType !== "king")) {
      const row = document.createElement("div");
      row.className = "custom-count-line";
      const image = document.createElement("img");
      image.src = `${color === "white" ? "./img/w_" : "./img/b_"}${type}.png`;
      image.alt = "";
      const label = document.createElement("span");
      label.textContent = type[0].toUpperCase() + type.slice(1);
      const stepper = document.createElement("div");
      stepper.className = "count-stepper";
      for (const step of [-1, 1]) {
        const button = document.createElement("button");
        const count = state.randomCounts[color][type];
        const total = countPieceTotal(state.randomCounts);
        button.type = "button";
        button.dataset.countColor = color;
        button.dataset.countType = type;
        button.dataset.countStep = String(step);
        button.dataset.countKey = `${color}-${type}-${step}`;
        button.textContent = step > 0 ? "+" : "−";
        button.disabled = step < 0 ? count === 0 : count >= CUSTOM_PIECE_LIMITS[type] || total >= 32;
        button.setAttribute("aria-label", `${step > 0 ? "Add" : "Remove"} one ${color} ${type}`);
        stepper.append(button);
      }
      const output = document.createElement("output");
      output.textContent = String(state.randomCounts[color][type]);
      stepper.append(output);
      row.append(image, label, stepper);
      group.append(row);
    }
    return group;
  });
  elements.randomCounts.replaceChildren(...groups);
  const total = countPieceTotal(state.randomCounts);
  elements.randomCountSummary.textContent = `${total} of 32 pieces selected`;
  if (activeKey) elements.randomCounts.querySelector(`[data-count-key="${activeKey}"]`)?.focus();
}

// Count the selected pieces across both sides.
function countPieceTotal(counts) {
  return ["white", "black"].reduce((total, color) => (
    total + CUSTOM_PIECE_TYPES.reduce((sideTotal, type) => sideTotal + counts[color][type], 0)
  ), 0);
}

// Select a piece type for manual placement.
function chooseCustomPiece(event, state, elements) {
  const button = event.target.closest("button[data-piece-type]");
  if (!button) return;
  state.customPieceType = button.dataset.pieceType;
  state.customTool = "piece";
  state.customMessage = "";
  renderCustomEditor(state, elements);
  elements.customPiecePalette.querySelector(`[data-piece-type="${state.customPieceType}"]`)?.focus();
}

// Switch between manual placement and the count-based random layout.
function chooseCustomMethod(event, state, elements) {
  const button = event.target.closest("button[data-custom-method]");
  if (!button) return;
  state.customMethod = button.dataset.customMethod;
  state.customMessage = "";
  renderCustomEditor(state, elements);
  elements.customMethod.querySelector(`[data-custom-method="${state.customMethod}"]`)?.focus();
}

// Select the board eraser tool.
function selectEraseTool(state, elements) {
  state.customTool = "erase";
  state.customMessage = "";
  renderCustomEditor(state, elements);
  elements.customErase.focus();
}

// Place or remove a piece on the custom board.
function placeCustomPiece(event, state, elements) {
  const button = event.target.closest("button[data-square]");
  if (!button) return;
  const square = button.dataset.square;
  const occupied = state.customPieces.some((piece) => piece.square === square);
  if (state.customTool === "erase") {
    state.customPieces = state.customPieces.filter((piece) => piece.square !== square);
  } else {
    if (state.customPieceType === "pawn" && ["1", "8"].includes(square[1])) {
      state.customMessage = "Pawns cannot start on the first or eighth rank.";
      renderCustomEditor(state, elements);
      return;
    }
    if (!occupied && state.customPieces.length >= 32) {
      state.customMessage = "Custom boards support up to 32 pieces.";
      renderCustomEditor(state, elements);
      return;
    }
    state.customPieces = [
      ...state.customPieces.filter((piece) => piece.square !== square && !(
        state.customPieceType === "king" && piece.type === "king" && piece.color === state.customPieceColor
      )),
      {
        type: state.customPieceType,
        color: state.customPieceColor,
        square,
        first_move: hasFirstMoveRight(state.customPieceType, state.customPieceColor, square),
      },
    ];
  }
  state.customMessage = "";
  renderCustomEditor(state, elements);
  elements.customBoard.querySelector(`[data-square="${square}"]`)?.focus();
}

// Restore the editor to one king on each side.
function resetCustomBoard(state, elements) {
  state.customPieces = makeDefaultCustomPieces();
  state.customMessage = "";
  renderCustomEditor(state, elements);
  elements.customBoard.querySelector('[data-square="e1"]')?.focus();
}

// Change a random-placement count without exceeding the desktop limits.
function adjustRandomCount(event, state, elements) {
  const button = event.target.closest("button[data-count-type]");
  if (!button) return;
  const { countColor: color, countType: type } = button.dataset;
  const nextCount = state.randomCounts[color][type] + Number(button.dataset.countStep);
  if (nextCount < 0 || nextCount > CUSTOM_PIECE_LIMITS[type]) return;
  if (button.dataset.countStep === "1" && countPieceTotal(state.randomCounts) >= 32) return;
  state.randomCounts = {
    ...state.randomCounts,
    [color]: { ...state.randomCounts[color], [type]: nextCount },
  };
  renderRandomCounts(state, elements);
}

// Randomly arrange the selected piece counts on distinct legal starting squares.
function randomizeBoard(state, elements) {
  try {
    state.customPieces = randomizeCustomPieces(state.randomCounts);
    state.customMessage = "";
  } catch (error) {
    state.customMessage = error.message;
  }
  renderCustomEditor(state, elements);
}

// Read and validate all setup inputs before starting a game.
function readSettings(state, elements) {
  const depth = Number(elements.depthInput.value);
  const iterations = Number(elements.iterationInput.value);
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) {
    elements.depthInput.setCustomValidity(`Enter a depth from 1 to ${MAX_DEPTH}.`);
    elements.depthInput.reportValidity();
    return false;
  }
  elements.depthInput.setCustomValidity("");
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_MCTS_ITERATIONS) {
    elements.iterationInput.setCustomValidity(`Enter between 1 and ${MAX_MCTS_ITERATIONS} iterations.`);
    elements.iterationInput.reportValidity();
    return false;
  }
  elements.iterationInput.setCustomValidity("");
  state.mode = elements.gameMode.value;
  state.practiceLevel = elements.practiceLevel.value;
  state.depth = depth;
  state.iterations = iterations;
  state.algorithms = isHumanMode(state)
    ? { white: "human", black: elements.humanAlgorithm.value }
    : { white: elements.whiteAlgorithm.value, black: elements.blackAlgorithm.value };
  return true;
}

// Start a new game after the selected settings pass the API limits.
async function startGameFromForm(state, elements) {
  if (!readSettings(state, elements)) return;
  const startPosition = state.positionType === "custom"
    ? buildCustomPosition(state.customPieces)
    : { type: "standard" };
  if (state.positionType === "custom") {
    state.customMessage = validateCustomPieces(state.customPieces);
    renderCustomEditor(state, elements);
    if (state.customMessage) return;
  }
  await startNewGame(state, elements, startPosition);
}

// Fetch the new-game response before replacing an existing game.
async function startNewGame(state, elements, startingPosition = state.startPosition) {
  const previous = {
    startPosition: state.startPosition,
    moves: state.moves,
  };
  state.pendingNewStartPosition = startingPosition;
  state.loading = true;
  state.error = "";
  state.retryTask = "new-game";
  state.auto = false;
  render(state, elements);
  try {
    const result = await postJson("/api/new-game", { start_position: startingPosition });
    state.startPosition = result.start_position;
    state.moves = result.moves;
    state.legalMoves = result.legal_moves;
    state.game = result.game;
    state.selectedSquare = null;
    state.pendingPromotion = null;
    state.lastAi = null;
    state.coachHint = null;
    state.coachNote = "";
    state.aiPaused = false;
    state.started = true;
    state.retryTask = null;
    state.pendingNewStartPosition = null;
    elements.setupScreen.hidden = true;
    elements.gameScreen.hidden = false;
  } catch (error) {
    state.startPosition = previous.startPosition;
    state.moves = previous.moves;
    setApiError(state, error, "new-game");
  } finally {
    state.loading = false;
    render(state, elements);
  }
}

// Send JSON to the same-project API and preserve its clear error message.
async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response. Try again.");
  }
  if (!response.ok) throw new Error(result.error || `The request failed (${response.status}).`);
  return result;
}

// Refresh legal moves and status using the complete client-owned move history.
async function refreshPosition(state, elements) {
  try {
    const result = await postJson("/api/legal-moves", makeGamePayload(state.startPosition, state.moves));
    state.legalMoves = result.legal_moves;
    state.game = result.game;
    state.error = "";
    state.retryTask = null;
    state.aiPaused = false;
    return true;
  } catch (error) {
    setApiError(state, error, "legal-moves");
    return false;
  } finally {
    render(state, elements);
  }
}

// Move the selected human piece, then refresh status and request Black's reply.
async function playHumanMove(state, elements, move) {
  if (state.loading || state.game.status === "checkmate" || state.game.status === "stalemate" || state.game.status === "draw") return;
  if (state.mode === "practice" && state.coachHint) {
    state.coachNote = movesMatch(move, state.coachHint)
      ? "Good find. You played the engine’s top candidate."
      : `The engine’s top candidate was ${state.coachHint.from}–${state.coachHint.to}. Consider its plan, then try without the hint next time.`;
  }
  state.coachHint = null;
  state.moves = [...state.moves, move];
  state.selectedSquare = null;
  state.pendingPromotion = null;
  state.loading = true;
  state.error = "";
  state.retryTask = "legal-moves";
  render(state, elements);
  const refreshed = await refreshPosition(state, elements);
  state.loading = false;
  render(state, elements);
  if (refreshed && isHumanMode(state) && currentColor(state) === "black" && !isGameOver(state)) {
    await runAiTurn(state, elements);
  }
}

// Ask the selected side's engine for one move using the stateless request format.
async function runAiTurn(state, elements) {
  if (state.loading || !state.started || isGameOver(state)) return false;
  const color = currentColor(state);
  if (isHumanMode(state) && color !== "black") return false;
  const algorithm = state.algorithms[color];
  const practiceSearch = state.mode === "practice" ? PRACTICE_LEVELS[state.practiceLevel] : null;
  const payload = {
    ...makeGamePayload(state.startPosition, state.moves),
    algorithm,
    depth: practiceSearch?.depth ?? state.depth,
    mcts_iterations: practiceSearch?.iterations ?? state.iterations,
  };
  state.loading = true;
  state.error = "";
  state.aiPaused = false;
  state.retryTask = "ai-move";
  render(state, elements);
  try {
    const result = await postJson("/api/ai-move", payload);
    state.moves = result.moves;
    state.game = result.game;
    state.lastAi = { algorithm, color, ...result };
    state.selectedSquare = null;
    state.retryTask = "legal-moves";
    const refreshed = await refreshPosition(state, elements);
    if (!refreshed) state.aiPaused = true;
    return refreshed;
  } catch (error) {
    setApiError(state, error, "ai-move");
    state.aiPaused = true;
    return false;
  } finally {
    state.loading = false;
    render(state, elements);
  }
}

// Request the engine's best candidate for the current human position.
async function requestCoachHint(state, elements) {
  if (state.loading || state.coachLoading || state.mode !== "practice" || currentColor(state) !== "white" || isGameOver(state)) return;
  const search = PRACTICE_LEVELS[state.practiceLevel];
  state.coachLoading = true;
  state.coachNote = "The coach is checking this position…";
  render(state, elements);
  try {
    const result = await postJson("/api/ai-move", {
      ...makeGamePayload(state.startPosition, state.moves),
      algorithm: state.algorithms.black,
      depth: search.depth,
      mcts_iterations: search.iterations,
    });
    state.coachHint = result.move;
    state.coachNote = `Try to find the idea. The engine points to ${result.move.from}–${result.move.to}.`;
  } catch (error) {
    state.coachNote = `Hint unavailable: ${error.message}`;
  } finally {
    state.coachLoading = false;
    render(state, elements);
  }
}

// Identify modes where White is controlled by the player.
function isHumanMode(state) {
  return state.mode === "human" || state.mode === "practice";
}

// Keep asking the engine for moves until Auto is turned off or the game ends.
async function runAutoLoop(state, elements) {
  while (state.auto && !isGameOver(state)) {
    const succeeded = await runAiTurn(state, elements);
    if (!succeeded || !state.auto || isGameOver(state)) break;
    await wait(280);
  }
}

// Pause or resume the AI-versus-AI autoplay loop.
function toggleAutoPlay(state, elements) {
  state.auto = !state.auto;
  render(state, elements);
  if (state.auto) runAutoLoop(state, elements);
}

// Wait briefly between AI turns so autoplay remains readable.
function wait(milliseconds) {
  // Resolve this promise after the requested browser delay.
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

// Retry the last failed request without clearing the current position.
async function retryLastRequest(state, elements) {
  if (state.loading || !state.retryTask) return;
  const task = state.retryTask;
  state.error = "";
  if (task === "new-game") return startNewGame(state, elements, state.pendingNewStartPosition || state.startPosition);
  if (task === "legal-moves") {
    state.loading = true;
    render(state, elements);
    const refreshed = await refreshPosition(state, elements);
    state.loading = false;
    render(state, elements);
    if (refreshed && isHumanMode(state) && currentColor(state) === "black") await runAiTurn(state, elements);
    return;
  }
  await runAiTurn(state, elements);
}

// Store a user-facing error and the request that can be retried.
function setApiError(state, error, task) {
  state.error = error instanceof Error ? error.message : "The request failed. Try again.";
  state.retryTask = task;
}

// Undo one AI-versus-AI move or the last human-and-AI turn.
async function undoLastTurn(state, elements) {
  if (state.loading || !state.moves.length) return;
  state.auto = false;
  const lastMove = state.moves[state.moves.length - 1];
  const moveCount = isHumanMode(state) && lastMove.from && currentColor(state) === "white" ? 2 : 1;
  state.moves = state.moves.slice(0, Math.max(0, state.moves.length - moveCount));
  state.lastAi = null;
  state.coachHint = null;
  state.coachNote = "";
  state.selectedSquare = null;
  state.loading = true;
  state.retryTask = "legal-moves";
  render(state, elements);
  await refreshPosition(state, elements);
  state.loading = false;
  render(state, elements);
}

// Return the side whose move it is, starting with White on the standard board.
function currentColor(state) {
  return state.moves.length % 2 === 0 ? "white" : "black";
}

// Return whether the server has reported a terminal game state.
function isGameOver(state) {
  return ["checkmate", "stalemate", "draw"].includes(state.game.status);
}

// Handle selection, legal destinations, and promotion choices on the board.
function handleBoardClick(event, state, elements) {
  const squareButton = event.target.closest("button[data-square]");
  if (!squareButton || state.loading || !isHumanMode(state) || currentColor(state) !== "white") return;
  const square = squareButton.dataset.square;
  // Keep only legal moves from the selected source to this destination.
  const selectedMoveOptions = state.legalMoves.filter((move) => move.from === state.selectedSquare && move.to === square);
  if (selectedMoveOptions.length > 1) {
    state.pendingPromotion = { from: state.selectedSquare, to: square };
    renderPromotionPicker(state, elements);
    return;
  }
  if (selectedMoveOptions.length === 1) {
    playHumanMove(state, elements, selectedMoveOptions[0]);
    return;
  }

  const board = getDisplayBoard(state);
  const piece = board[squareToIndex(square)];
  const isWhitePiece = typeof piece === "string" && piece === piece.toUpperCase();
  state.selectedSquare = isWhitePiece ? square : null;
  render(state, elements);
}

// Show the four legal piece choices for a pawn promotion.
function renderPromotionPicker(state, elements) {
  // Build one labeled option button for each promotion piece.
  const choices = PROMOTION_TYPES.map((piece) => {
    const image = document.createElement("img");
    image.src = `./img/w_${piece.name}.png`;
    image.alt = "";
    const button = document.createElement("button");
    button.className = "promotion-choice";
    button.type = "button";
    button.dataset.promotion = piece.code;
    button.setAttribute("aria-label", `Promote pawn to ${piece.name}`);
    button.append(image);
    return button;
  });
  elements.promotionOptions.replaceChildren(...choices);
  elements.promotion.hidden = false;
  choices[0].focus();
}

// Apply the selected promotion option and close the picker.
function choosePromotion(event, state, elements) {
  const button = event.target.closest("button[data-promotion]");
  if (!button || !state.pendingPromotion) return;
  const move = { ...state.pendingPromotion, promotion: button.dataset.promotion };
  closePromotionPicker(state, elements);
  playHumanMove(state, elements, move);
}

// Close the promotion picker and return focus to the board.
function closePromotionPicker(state, elements) {
  elements.promotion.hidden = true;
  state.pendingPromotion = null;
  elements.board.querySelector("button[data-square]")?.focus();
}

// Rebuild the visible board from the standard start and the replayed moves.
function getDisplayBoard(state) {
  const board = Array(64).fill(null);
  if (state.startPosition.type === "standard") {
    board.splice(0, 64, ..."rnbqkbnr", ...Array(8).fill("p"), ...Array(32).fill(null), ...Array(8).fill("P"), ..."RNBQKBNR");
  } else {
    for (const piece of state.startPosition.pieces) {
      const symbol = { king: "k", queen: "q", rook: "r", bishop: "b", knight: "n", pawn: "p" }[piece.type];
      board[squareToIndex(piece.square)] = piece.color === "white" ? symbol.toUpperCase() : symbol;
    }
  }
  for (const move of state.moves) applyDisplayMove(board, move);
  return board;
}

// Apply a legal move to the display-only board, including special chess moves.
function applyDisplayMove(board, move) {
  const from = squareToIndex(move.from);
  const to = squareToIndex(move.to);
  const piece = board[from];
  if (!piece) return;
  const fromRow = Math.floor(from / 8);
  const toRow = Math.floor(to / 8);
  const fromColumn = from % 8;
  const toColumn = to % 8;
  if (piece.toLowerCase() === "p" && fromColumn !== toColumn && board[to] === null) {
    board[to + (fromRow > toRow ? 8 : -8)] = null;
  }
  if (piece.toLowerCase() === "k" && Math.abs(to - from) === 2) {
    const rookFrom = to > from ? from + 3 : from - 4;
    const rookTo = to > from ? from + 1 : from - 1;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }
  board[from] = null;
  board[to] = move.promotion ? (piece === piece.toUpperCase() ? move.promotion : move.promotion.toLowerCase()) : piece;
}

// Draw the board, status, controls, and error messages from the current state.
function render(state, elements) {
  renderBoard(state, elements);
  renderStatus(state, elements);
  renderControls(state, elements);
  elements.loading.hidden = !state.loading;
  elements.loadingMessage.textContent = currentColor(state) === "white" ? "Updating the board…" : "The engine is thinking…";
  elements.error.hidden = !state.error;
  elements.errorText.textContent = state.error;
  elements.retry.hidden = !state.retryTask;
  const setupErrorIsVisible = !elements.setupScreen.hidden && Boolean(state.error);
  elements.setupError.hidden = !setupErrorIsVisible;
  elements.setupErrorText.textContent = state.error;
  elements.setupRetry.hidden = !state.retryTask;
  elements.auto.textContent = state.auto ? "Auto: On" : "Auto: Off";
  elements.auto.setAttribute("aria-pressed", String(state.auto));
  elements.undo.disabled = state.loading || state.moves.length === 0;
  renderAiSummary(state, elements);
}

// Render accessible square buttons, piece images, and move highlights.
function renderBoard(state, elements) {
  const board = getDisplayBoard(state);
  const lastMove = state.moves[state.moves.length - 1];
  const lastMoveSquares = lastMove ? [lastMove.from, lastMove.to] : [];
  // Mark unique legal destination squares for the selected piece.
  const destinations = new Set(state.legalMoves.filter((move) => move.from === state.selectedSquare).map((move) => move.to));
  const checkedKing = ["check", "checkmate"].includes(state.game.status)
    ? findKingSquare(board, currentColor(state))
    : null;
  // Build one accessible button for every square in the visible position.
  const squares = board.map((piece, index) => {
    const square = indexToSquare(index);
    const button = document.createElement("button");
    const isLight = (Math.floor(index / 8) + index % 8) % 2 === 1;
    button.className = `square ${isLight ? "light" : "dark"}`;
    button.type = "button";
    button.dataset.square = square;
    button.setAttribute("role", "gridcell");
    const color = piece && piece === piece.toUpperCase() ? "White" : "Black";
    const name = piece ? `${color} ${PIECE_NAMES[piece.toLowerCase()]}` : "empty";
    button.setAttribute("aria-label", `${square}, ${name}`);
    if (piece) {
      const image = document.createElement("img");
      image.src = `./img/${piece === piece.toUpperCase() ? "w" : "b"}_${PIECE_NAMES[piece.toLowerCase()]}.png`;
      image.alt = "";
      button.append(image);
    }
    if (square === state.selectedSquare) button.classList.add("selected");
    if (state.coachHint && [state.coachHint.from, state.coachHint.to].includes(square)) button.classList.add("coach-hint-square");
    if (destinations.has(square)) button.classList.add("legal-target");
    if (lastMoveSquares.includes(square)) button.classList.add("last-move");
    if (square === checkedKing) button.classList.add("in-check");
    button.disabled = state.loading || !isHumanMode(state) || currentColor(state) !== "white" || isGameOver(state);
    return button;
  });
  elements.board.replaceChildren(...squares);
  elements.boardWrap.classList.toggle("is-busy", state.loading);
}

// Find the side-to-move king square for the check highlight.
function findKingSquare(board, color) {
  const king = color === "white" ? "K" : "k";
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] === king) return indexToSquare(index);
  }
  return null;
}

// Render the current turn and the server's terminal or check status.
function renderStatus(state, elements) {
  const color = currentColor(state);
  const side = color === "white" ? "White" : "Black";
  const status = state.game.status;
  const messages = {
    ongoing: `${side} to move`,
    check: `${side} to move · Check`,
    checkmate: `Checkmate · ${color === "white" ? "Black" : "White"} wins`,
    stalemate: "Draw · Stalemate",
    draw: `Draw · ${state.game.draw_reason || "draw"}`,
  };
  const isHumanTurn = isHumanMode(state) && color === "white";
  elements.turnIndicator.lastElementChild.textContent = isHumanTurn ? "Your move" : `${side} to move`;
  elements.turnIndicator.querySelector(".turn-dot").classList.toggle("black", color === "black");
  elements.gameStatus.textContent = messages[status] || messages.ongoing;
  elements.gameStatus.classList.toggle("terminal", isGameOver(state));
}

// Show the controls that match the selected mode and whether a retry is needed.
function renderControls(state, elements) {
  elements.humanControls.hidden = !isHumanMode(state);
  elements.aiControls.hidden = state.mode !== "ai";
  const isPractice = state.mode === "practice";
  elements.coachHint.hidden = !isPractice || currentColor(state) !== "white" || isGameOver(state);
  elements.coachHint.disabled = state.loading || state.coachLoading || isGameOver(state);
  elements.coachHint.textContent = state.coachLoading ? "Thinking…" : "Get a hint";
  elements.coachNote.hidden = !isPractice || !state.coachNote;
  elements.coachNote.textContent = state.coachNote;
  const humanNeedsAi = isHumanMode(state) && currentColor(state) === "black" && !isGameOver(state);
  elements.humanRunAi.hidden = !humanNeedsAi || (!state.aiPaused && !state.error);
  elements.humanRunAi.disabled = state.loading;
  elements.runAi.disabled = state.loading || isGameOver(state);
  elements.auto.disabled = isGameOver(state);
  elements.modeSummary.textContent = state.mode === "practice" ? "Practice with coach" : state.mode === "human" ? "Human vs AI" : "AI vs AI";
  // Format the selected engine for each side in the panel summary.
  const describe = (color) => `${color[0].toUpperCase()}${color.slice(1)} · ${algorithmName(state.algorithms[color])}`;
  elements.algorithmSummary.textContent = isHumanMode(state) ? `${describe("black")}${state.mode === "practice" ? ` · ${state.practiceLevel}` : ""}` : `${describe("white")}  /  ${describe("black")}`;
}

// Format the most recent AI move with the engine work report.
function renderAiSummary(state, elements) {
  if (!state.lastAi) {
    elements.lastAi.textContent = "No AI moves yet.";
    return;
  }
  const result = state.lastAi;
  const work = result.node_count !== undefined
    ? `${result.node_count.toLocaleString()} nodes · depth ${result.depth_completed}`
    : `${result.iteration_count} iterations`;
  elements.lastAi.textContent = `${result.color} · ${algorithmName(result.algorithm)} · ${result.move.from}–${result.move.to} · ${result.evaluation} cp · ${work} · ${result.time_seconds}s`;
}

// Return a readable algorithm label for controls and the result summary.
function algorithmName(algorithm) {
  return algorithm === "mcts" ? "MCTS" : "Alpha-Beta";
}

// Return to setup while preserving the current game in memory.
function showSetup(state, elements) {
  state.auto = false;
  state.selectedSquare = null;
  state.positionType = state.startPosition.type;
  if (state.positionType === "custom") state.customPieces = state.startPosition.pieces;
  elements.gameScreen.hidden = true;
  elements.setupScreen.hidden = false;
  elements.gameMode.value = state.mode;
  elements.practiceLevel.value = state.practiceLevel;
  elements.humanAlgorithm.value = state.algorithms.black === "human" ? "alphabeta" : state.algorithms.black;
  elements.whiteAlgorithm.value = state.algorithms.white === "human" ? "alphabeta" : state.algorithms.white;
  elements.blackAlgorithm.value = state.algorithms.black === "human" ? "alphabeta" : state.algorithms.black;
  elements.depthInput.value = state.depth;
  elements.iterationInput.value = state.iterations;
  updateSetupVisibility(state, elements);
  renderCustomEditor(state, elements);
}
