```jsx
import React, { useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  linkWithPopup,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let auth = null;
let db = null;

if (firebaseConfig.apiKey && firebaseConfig.projectId) {
  const firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
}

const EMPTY_BOARD = Array(9).fill(null);

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function getWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (
      board[a] &&
      board[a] === board[b] &&
      board[a] === board[c]
    ) {
      return board[a];
    }
  }

  return board.every(Boolean) ? "draw" : null;
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Strong minimax bot
function getBestBotMove(board, botMark = "O") {
  const humanMark = botMark === "X" ? "O" : "X";

  function minimax(currentBoard, player) {
    const result = getWinner(currentBoard);

    if (result === botMark) return 10;
    if (result === humanMark) return -10;
    if (result === "draw") return 0;

    const scores = [];

    currentBoard.forEach((cell, index) => {
      if (!cell) {
        const nextBoard = [...currentBoard];
        nextBoard[index] = player;

        scores.push(
          minimax(
            nextBoard,
            player === botMark ? humanMark : botMark
          )
        );
      }
    });

    return player === botMark
      ? Math.max(...scores)
      : Math.min(...scores);
  }

  let bestScore = -Infinity;
  let bestMove = -1;

  board.forEach((cell, index) => {
    if (!cell) {
      const nextBoard = [...board];
      nextBoard[index] = botMark;

      const score = minimax(nextBoard, humanMark);

      if (score > bestScore) {
        bestScore = score;
        bestMove = index;
      }
    }
  });

  return bestMove;
}

export default function App() {
  const [user, setUser] = useState(null);

  const [name, setName] = useState("");

  const [stats, setStats] = useState({
    wins: 0,
    losses: 0,
    draws: 0,
  });

  const [mode, setMode] = useState("home");

  const [board, setBoard] = useState(EMPTY_BOARD);

  const [turn, setTurn] = useState("X");

  const [room, setRoom] = useState("");

  const [myMark, setMyMark] = useState("X");

  const [status, setStatus] = useState("");

  const [leaders, setLeaders] = useState([]);

  const [copied, setCopied] = useState(false);

  const result = useMemo(
    () => getWinner(board),
    [board]
  );

  // Firebase anonymous authentication
  useEffect(() => {
    if (!auth) {
      setStatus("Firebase is not configured.");
      return;
    }

    signInAnonymously(auth).catch((error) => {
      console.error(error);
      setStatus("Authentication failed.");
    });

    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser);
      }
    );

    return unsubscribe;
  }, []);

  // Load player profile
  useEffect(() => {
    if (!user || !db) return;

    getDoc(doc(db, "players", user.uid))
      .then((snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();

          setName(data.name || "");

          setStats(
            data.stats || {
              wins: 0,
              losses: 0,
              draws: 0,
            }
          );
        }
      })
      .catch((error) => {
        console.error(error);
      });
  }, [user]);

  // Detect invite link
  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search
    );

    const inviteRoom = params.get("room");

    if (inviteRoom) {
      const cleanRoom = inviteRoom
        .trim()
        .toUpperCase();

      if (/^[A-Z0-9]{6}$/.test(cleanRoom)) {
        setRoom(cleanRoom);
        setMode("join");
      }
    }
  }, []);

  // ============================================================
  // IMPORTANT ONLINE ROOM LISTENER
  // Never call Firestore until room is a valid 6-character code.
  // ============================================================
  useEffect(() => {
    if (
      mode !== "online" ||
      !db ||
      !user ||
      !room ||
      !/^[A-Z0-9]{6}$/.test(room)
    ) {
      return;
    }

    const roomRef = doc(db, "games", room);

    const unsubscribe = onSnapshot(
      roomRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setStatus("ROOM NOT FOUND");
          return;
        }

        const game = snapshot.data();

        setBoard(
          Array.isArray(game.board)
            ? game.board
            : EMPTY_BOARD
        );

        setTurn(game.turn || "X");

        if (game.host === user.uid) {
          setMyMark("X");
        } else if (game.guest === user.uid) {
          setMyMark("O");
        }

        if (game.status === "waiting") {
          setStatus("WAITING FOR OPPONENT");
        } else if (game.status === "playing") {
          setStatus(
            game.turn ===
              (game.host === user.uid ? "X" : "O")
              ? "YOUR TURN"
              : "OPPONENT'S TURN"
          );
        } else if (game.status === "done") {
          setStatus(game.result || "GAME OVER");
        }
      },
      (error) => {
        console.error("Room listener error:", error);
        setStatus("Unable to connect to this room.");
      }
    );

    return unsubscribe;
  }, [mode, room, user]);

  // ============================================================
  // SAVE PLAYER RESULT
  // ============================================================
  async function saveResult(resultType) {
    if (!db || !user || !name.trim()) return;

    const newStats = { ...stats };

    if (resultType === "win") {
      newStats.wins += 1;
    }

    if (resultType === "loss") {
      newStats.losses += 1;
    }

    if (resultType === "draw") {
      newStats.draws += 1;
    }

    setStats(newStats);

    try {
      await setDoc(
        doc(db, "players", user.uid),
        {
          name: name.trim(),
          stats: newStats,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error("Saving player failed:", error);
    }
  }

  // ============================================================
  // PRO BOT
  // ============================================================
  function playBot(index) {
    if (
      result ||
      board[index] ||
      turn !== "X"
    ) {
      return;
    }

    const playerBoard = [...board];

    playerBoard[index] = "X";

    const playerResult = getWinner(playerBoard);

    setBoard(playerBoard);

    if (playerResult) {
      setStatus(
        playerResult === "draw"
          ? "DRAW"
          : "YOU WIN"
      );

      saveResult(
        playerResult === "X"
          ? "win"
          : "draw"
      );

      return;
    }

    setTurn("O");

    setTimeout(() => {
      const botMove = getBestBotMove(
        playerBoard,
        "O"
      );

      if (botMove < 0) return;

      const botBoard = [...playerBoard];

      botBoard[botMove] = "O";

      const botResult = getWinner(botBoard);

      setBoard(botBoard);

      if (botResult) {
        setStatus(
          botResult === "draw"
            ? "DRAW"
            : "PRO BOT WINS"
        );

        saveResult(
          botResult === "O"
            ? "loss"
            : "draw"
        );
      } else {
        setTurn("X");
      }
    }, 300);
  }

  // ============================================================
  // CREATE ROOM
  // ============================================================
  async function createRoom() {
    if (!db || !user) {
      setStatus("Firebase is not ready.");
      return;
    }

    try {
      // Generate code FIRST.
      const roomCode = generateRoomCode();

      // Validate BEFORE using Firestore.
      if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
        setStatus("Could not generate room code.");
        return;
      }

      const roomRef = doc(
        db,
        "games",
        roomCode
      );

      await setDoc(roomRef, {
        board: EMPTY_BOARD,
        turn: "X",
        status: "waiting",
        host: user.uid,
        guest: null,
        result: null,
        createdAt: serverTimestamp(),
      });

      setRoom(roomCode);
      setMyMark("X");
      setBoard(EMPTY_BOARD);
      setTurn("X");
      setStatus("WAITING FOR OPPONENT");
      setMode("online");
    } catch (error) {
      console.error("Create room error:", error);
      setStatus("Could not create room.");
    }
  }

  // ============================================================
  // JOIN ROOM
  // ============================================================
  async function joinRoom(roomCode = room) {
    if (!db || !user) {
      setStatus("Firebase is not ready.");
      return;
    }

    const cleanRoom = roomCode
      .trim()
      .toUpperCase();

    // IMPORTANT: Never access games until this is valid.
    if (!/^[A-Z0-9]{6}$/.test(cleanRoom)) {
      setStatus("ENTER A VALID 6-CHARACTER ROOM CODE");
      return;
    }

    try {
      const roomRef = doc(
        db,
        "games",
        cleanRoom
      );

      const snapshot = await getDoc(roomRef);

      if (!snapshot.exists()) {
        setStatus("ROOM NOT FOUND");
        return;
      }

      const game = snapshot.data();

      // Host opening their own room
      if (game.host === user.uid) {
        setMyMark("X");
      } else {
        // Room already has another guest
        if (
          game.guest &&
          game.guest !== user.uid
        ) {
          setStatus("ROOM FULL");
          return;
        }

        await updateDoc(roomRef, {
          guest: user.uid,
          status: "playing",
        });

        setMyMark("O");
      }

      setRoom(cleanRoom);
      setBoard(
        Array.isArray(game.board)
          ? game.board
          : EMPTY_BOARD
      );
      setTurn(game.turn || "X");
      setMode("online");
      setStatus(
        game.guest || game.host === user.uid
          ? "LIVE MATCH"
          : "JOINING..."
      );
    } catch (error) {
      console.error("Join room error:", error);
      setStatus("Unable to join this room.");
    }
  }

  // ============================================================
  // ONLINE MOVE
  // ============================================================
  async function makeOnlineMove(index) {
    // HARD SAFETY CHECK
    if (
      !db ||
      !user ||
      !room ||
      !/^[A-Z0-9]{6}$/.test(room)
    ) {
      setStatus("Invalid room.");
      return;
    }

    if (
      result ||
      board[index] ||
      turn !== myMark
    ) {
      return;
    }

    try {
      const roomRef = doc(
        db,
        "games",
        room
      );

      // Read latest Firebase state before moving.
      const snapshot = await getDoc(roomRef);

      if (!snapshot.exists()) {
        setStatus("ROOM NOT FOUND");
        return;
      }

      const game = snapshot.data();

      const latestBoard = Array.isArray(
        game.board
      )
        ? game.board
        : EMPTY_BOARD;

      const latestTurn = game.turn || "X";

      // Prevent stale clients from making invalid moves.
      if (
        latestTurn !== myMark ||
        latestBoard[index]
      ) {
        return;
      }

      const nextBoard = [...latestBoard];

      nextBoard[index] = myMark;

      const gameResult = getWinner(nextBoard);

      await updateDoc(roomRef, {
        board: nextBoard,
        turn:
          myMark === "X"
            ? "O"
            : "X",
        status: gameResult
          ? "done"
          : "playing",
        result: gameResult
          ? gameResult === "draw"
            ? "DRAW"
            : `${gameResult} WINS`
          : null,
        lastMove: index,
        lastMoveAt: serverTimestamp(),
      });

      if (gameResult) {
        await saveResult(
          gameResult === myMark
            ? "win"
            : gameResult === "draw"
            ? "draw"
            : "loss"
        );
      }
    } catch (error) {
      console.error("Move error:", error);
      setStatus("Move could not be sent.");
    }
  }

  // ============================================================
  // REMATCH
  // ============================================================
  async function rematch() {
    if (mode === "online") {
      if (
        !db ||
        !room ||
        !/^[A-Z0-9]{6}$/.test(room)
      ) {
        setStatus("Invalid room.");
        return;
      }

      try {
        await updateDoc(
          doc(db, "games", room),
          {
            board: EMPTY_BOARD,
            turn: "X",
            status: "playing",
            result: null,
            lastMove: null,
          }
        );
      } catch (error) {
        console.error("Rematch error:", error);
        setStatus("Could not start rematch.");
      }

      return;
    }

    setBoard(EMPTY_BOARD);
    setTurn("X");
    setStatus("");
  }

  // ============================================================
  // GOOGLE AUTH
  // ============================================================
  async function googleLogin() {
    if (!auth) {
      setStatus("Firebase is not configured.");
      return;
    }

    try {
      const provider =
        new GoogleAuthProvider();

      if (user?.isAnonymous) {
        await linkWithPopup(
          user,
          provider
        );
      } else {
        await signInWithPopup(
          auth,
          provider
        );
      }

      setStatus("GOOGLE PROFILE SAVED");
    } catch (error) {
      console.error("Google login error:", error);
      setStatus(
        error.code || "Google login failed."
      );
    }
  }

  // ============================================================
  // LEADERBOARD
  // ============================================================
  async function loadLeaderboard() {
    if (!db) {
      setStatus("Firebase is not configured.");
      return;
    }

    try {
      const playersQuery = query(
        collection(db, "players"),
        orderBy("stats.wins", "desc"),
        limit(10)
      );

      const snapshot =
        await getDocs(playersQuery);

      setLeaders(
        snapshot.docs.map((item) =>
          item.data()
        )
      );

      setMode("leaders");
    } catch (error) {
      console.error(
        "Leaderboard error:",
        error
      );

      setStatus(
        "Could not load leaderboard."
      );
    }
  }

  const inviteLink =
    room &&
    /^[A-Z0-9]{6}$/.test(room)
      ? `${window.location.origin}${window.location.pathname}?room=${room}`
      : "";

  function copyInvite() {
    if (!inviteLink) return;

    navigator.clipboard
      ?.writeText(inviteLink)
      .then(() => {
        setCopied(true);

        setTimeout(
          () => setCopied(false),
          1200
        );
      })
      .catch(() => {
        setStatus("Could not copy link.");
      });
  }

  // ============================================================
  // HOME
  // ============================================================
  if (mode === "home") {
    return (
      <Home
        name={name}
        setName={setName}
        google={googleLogin}
        stats={stats}
        bot={() => {
          setBoard(EMPTY_BOARD);
          setTurn("X");
          setStatus("");
          setMode("bot");
        }}
        online={() => {
          setRoom("");
          setStatus("");
          setMode("join");
        }}
        leaders={loadLeaderboard}
        status={status}
      />
    );
  }

  // ============================================================
  // LEADERBOARD
  // ============================================================
  if (mode === "leaders") {
    return (
      <main>
        <Top
          title="LEADERBOARD"
          back={() => setMode("home")}
        />

        <section className="card leaders">
          <h1>TOP PLAYERS</h1>

          {leaders.length ? (
            leaders.map((player, index) => (
              <div
                className="rank"
                key={index}
              >
                <span>
                  #{index + 1}{" "}
                  {player.name || "PLAYER"}
                </span>

                <b>
                  {player.stats?.wins || 0} W
                </b>
              </div>
            ))
          ) : (
            <p>NO SAVED PLAYERS YET</p>
          )}
        </section>
      </main>
    );
  }

  // ============================================================
  // JOIN / CREATE SCREEN
  // ============================================================
  if (mode === "join") {
    return (
      <main>
        <Top
          title="ONLINE MATCH"
          back={() => setMode("home")}
        />

        <section className="card join">
          <div className="glitch">
            ENTER THE ARENA
          </div>

          <input
            value={room}
            maxLength={6}
            onChange={(event) =>
              setRoom(
                event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
              )
            }
            placeholder="ROOM CODE"
          />

          <button
            onClick={() => joinRoom()}
          >
            JOIN ROOM
          </button>

          <div className="or">
            OR
          </div>

          <button
            className="alt"
            onClick={createRoom}
          >
            CREATE ROOM
          </button>

          {status && (
            <p>{status}</p>
          )}
        </section>
      </main>
    );
  }

  // ============================================================
  // GAME
  // ============================================================
  return (
    <Game
      title={
        mode === "bot"
          ? "PRO BOT"
          : `ONLINE // ${room}`
      }
      board={board}
      turn={turn}
      mark={myMark}
      result={result}
      status={status}
      onCell={
        mode === "bot"
          ? playBot
          : makeOnlineMove
      }
      onBack={() => setMode("home")}
      rematch={rematch}
      link={
        mode === "online"
          ? inviteLink
          : ""
      }
      copy={copyInvite}
      copied={copied}
    />
  );
}

// ============================================================
// HEADER
// ============================================================
function Top({ title, back }) {
  return (
    <header>
      <b>
        ✦ XOX<span>NEON</span>
      </b>

      <strong>{title}</strong>

      <button
        className="back"
        onClick={back}
      >
        ESC
      </button>
    </header>
  );
}

// ============================================================
// HOME UI
// ============================================================
function Home({
  name,
  setName,
  google,
  stats,
  bot,
  online,
  leaders,
  status,
}) {
  return (
    <main>
      <header>
        <b>
          ✦ XOX<span>NEON</span>
        </b>

        <small>
          ARENA // ONLINE
        </small>
      </header>

      <section className="hero">
        <div className="eyebrow">
          TACTICAL GRID // 01
        </div>

        <h1>
          X<span>O</span>X
        </h1>

        <p>
          OUTPLAY. OUTTHINK. DOMINATE.
        </p>

        <div className="buttons">
          <button onClick={bot}>
            ⚡ PRO BOT
          </button>

          <button onClick={online}>
            ◈ ONLINE MATCH
          </button>
        </div>

        <button
          className="leaderBtn"
          onClick={leaders}
        >
          🏆 VIEW LEADERBOARD
        </button>
      </section>

      <section className="profile">
        <div>
          <label>
            PLAYER ID
          </label>

          <input
            value={name}
            onChange={(event) =>
              setName(event.target.value)
            }
            placeholder="Enter name to save stats"
          />
        </div>

        <button
          className="google"
          onClick={google}
        >
          G&nbsp; SAVE WITH GOOGLE
        </button>

        <div className="stats">
          <div>
            <b>{stats.wins}</b>
            <small>WINS</small>
          </div>

          <div>
            <b>{stats.losses}</b>
            <small>LOSSES</small>
          </div>

          <div>
            <b>{stats.draws}</b>
            <small>DRAWS</small>
          </div>
        </div>

        {status && (
          <small className="notice">
            {status}
          </small>
        )}
      </section>
    </main>
  );
}

// ============================================================
// GAME UI
// ============================================================
function Game({
  title,
  board,
  turn,
  mark,
  result,
  status,
  onCell,
  onBack,
  rematch,
  link,
  copy,
  copied,
}) {
  return (
    <main>
      <Top
        title={title}
        back={onBack}
      />

      <section className="game">
        <div className="matchbar">
          <span>
            YOU{" "}
            <b
              className={
                mark === "X"
                  ? "x"
                  : "o"
              }
            >
              {mark}
            </b>
          </span>

          <strong>
            {status}
          </strong>

          <span>
            TURN <b>{turn}</b>
          </span>
        </div>

        <div className="board">
          {board.map((value, index) => (
            <button
              key={index}
              disabled={
                !!value ||
                !!result
              }
              onClick={() =>
                onCell(index)
              }
              className={
                value
                  ? `cell ${value.toLowerCase()}`
                  : ""
              }
            >
              {value}
            </button>
          ))}
        </div>

        {link && (
          <div className="invite">
            <small>
              INVITE FRIEND
            </small>

            <div>
              <input
                readOnly
                value={link}
              />

              <button
                onClick={copy}
              >
                {copied
                  ? "COPIED"
                  : "COPY"}
              </button>
            </div>
          </div>
        )}

        {result && (
          <button
            className="wide"
            onClick={rematch}
          >
            ↻ REMATCH
          </button>
        )}
      </section>
    </main>
  );
}
```
