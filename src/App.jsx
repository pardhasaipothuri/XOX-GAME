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

try {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    const firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
  }
} catch (error) {
  console.error("Firebase initialization error:", error);
}

const EMPTY_BOARD = [
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
];

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 6],
  [2, 4, 6],
];

function getWinner(board) {
  for (let i = 0; i < WIN_LINES.length; i++) {
    const line = WIN_LINES[i];

    const a = line[0];
    const b = line[1];
    const c = line[2];

    if (
      board[a] &&
      board[a] === board[b] &&
      board[a] === board[c]
    ) {
      return board[a];
    }
  }

  let full = true;

  for (let i = 0; i < board.length; i++) {
    if (!board[i]) {
      full = false;
      break;
    }
  }

  if (full) {
    return "draw";
  }

  return null;
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += chars.charAt(
      Math.floor(Math.random() * chars.length)
    );
  }

  return code;
}

function isValidRoom(roomCode) {
  return /^[A-Z0-9]{6}$/.test(roomCode);
}

/* ============================================================
   UNBEATABLE BOT
============================================================ */

function getBestBotMove(board, botMark) {
  const humanMark = botMark === "X" ? "O" : "X";

  function minimax(currentBoard, player) {
    const winner = getWinner(currentBoard);

    if (winner === botMark) {
      return 10;
    }

    if (winner === humanMark) {
      return -10;
    }

    if (winner === "draw") {
      return 0;
    }

    const scores = [];

    for (let i = 0; i < currentBoard.length; i++) {
      if (!currentBoard[i]) {
        const nextBoard = currentBoard.slice();
        nextBoard[i] = player;

        const score = minimax(
          nextBoard,
          player === botMark ? humanMark : botMark
        );

        scores.push(score);
      }
    }

    if (player === botMark) {
      return Math.max.apply(null, scores);
    }

    return Math.min.apply(null, scores);
  }

  let bestScore = -Infinity;
  let bestMove = -1;

  for (let i = 0; i < board.length; i++) {
    if (!board[i]) {
      const nextBoard = board.slice();
      nextBoard[i] = botMark;

      const score = minimax(
        nextBoard,
        humanMark
      );

      if (score > bestScore) {
        bestScore = score;
        bestMove = i;
      }
    }
  }

  return bestMove;
}

/* ============================================================
   APP
============================================================ */

export default function App() {
  const [user, setUser] = useState(null);

  const [name, setName] = useState("");

  const [stats, setStats] = useState({
    wins: 0,
    losses: 0,
    draws: 0,
  });

  const [mode, setMode] = useState("home");

  const [board, setBoard] = useState(
    EMPTY_BOARD.slice()
  );

  const [turn, setTurn] = useState("X");

  const [room, setRoom] = useState("");

  const [myMark, setMyMark] = useState("X");

  const [status, setStatus] = useState("");

  const [leaders, setLeaders] = useState([]);

  const [copied, setCopied] = useState(false);

  const result = useMemo(
    function () {
      return getWinner(board);
    },
    [board]
  );

  /* ============================================================
     AUTH
  ============================================================ */

  useEffect(
    function () {
      if (!auth) {
        setStatus("Firebase is not configured.");
        return;
      }

      signInAnonymously(auth).catch(
        function (error) {
          console.error(error);
          setStatus("Authentication failed.");
        }
      );

      const unsubscribe =
        onAuthStateChanged(
          auth,
          function (currentUser) {
            setUser(currentUser);
          }
        );

      return unsubscribe;
    },
    []
  );

  /* ============================================================
     LOAD PROFILE
  ============================================================ */

  useEffect(
    function () {
      if (!user || !db) {
        return;
      }

      getDoc(
        doc(db, "players", user.uid)
      )
        .then(function (snapshot) {
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
        .catch(function (error) {
          console.error(
            "Profile loading error:",
            error
          );
        });
    },
    [user]
  );

  /* ============================================================
     INVITE LINK
  ============================================================ */

  useEffect(
    function () {
      const params =
        new URLSearchParams(
          window.location.search
        );

      const inviteRoom =
        params.get("room");

      if (inviteRoom) {
        const cleanRoom =
          inviteRoom
            .trim()
            .toUpperCase();

        if (isValidRoom(cleanRoom)) {
          setRoom(cleanRoom);
          setMode("join");
        }
      }
    },
    []
  );

  /* ============================================================
     REAL-TIME FIRESTORE LISTENER

     IMPORTANT:
     Never listen to "games".
     Always listen to "games/{room}".
  ============================================================ */

  useEffect(
    function () {
      if (
        mode !== "online" ||
        !db ||
        !user ||
        !room ||
        !isValidRoom(room)
      ) {
        return;
      }

      const roomRef = doc(
        db,
        "games",
        room
      );

      const unsubscribe =
        onSnapshot(
          roomRef,
          function (snapshot) {
            if (!snapshot.exists()) {
              setStatus("ROOM NOT FOUND");
              return;
            }

            const game =
              snapshot.data();

            const firebaseBoard =
              Array.isArray(game.board)
                ? game.board
                : EMPTY_BOARD.slice();

            setBoard(firebaseBoard);

            setTurn(
              game.turn || "X"
            );

            if (
              game.host === user.uid
            ) {
              setMyMark("X");
            } else if (
              game.guest === user.uid
            ) {
              setMyMark("O");
            }

            if (
              game.status === "waiting"
            ) {
              setStatus(
                "WAITING FOR OPPONENT"
              );
            } else if (
              game.status === "playing"
            ) {
              const playerMark =
                game.host === user.uid
                  ? "X"
                  : "O";

              if (
                game.turn ===
                playerMark
              ) {
                setStatus(
                  "YOUR TURN"
                );
              } else {
                setStatus(
                  "OPPONENT'S TURN"
                );
              }
            } else if (
              game.status === "done"
            ) {
              setStatus(
                game.result ||
                  "GAME OVER"
              );
            }
          },
          function (error) {
            console.error(
              "Room listener error:",
              error
            );

            setStatus(
              "Unable to connect to this room."
            );
          }
        );

      return unsubscribe;
    },
    [mode, room, user]
  );

  /* ============================================================
     SAVE STATS
  ============================================================ */

  async function saveResult(
    resultType
  ) {
    if (
      !db ||
      !user ||
      !name.trim()
    ) {
      return;
    }

    const newStats = {
      wins: stats.wins,
      losses: stats.losses,
      draws: stats.draws,
    };

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
        doc(
          db,
          "players",
          user.uid
        ),
        {
          name: name.trim(),
          stats: newStats,
          updatedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      );
    } catch (error) {
      console.error(
        "Save stats error:",
        error
      );
    }
  }

  /* ============================================================
     BOT GAME
  ============================================================ */

  function playBot(index) {
    if (
      mode !== "bot" ||
      result ||
      board[index] ||
      turn !== "X"
    ) {
      return;
    }

    const playerBoard =
      board.slice();

    playerBoard[index] = "X";

    const playerResult =
      getWinner(playerBoard);

    setBoard(playerBoard);

    if (playerResult) {
      if (playerResult === "X") {
        setStatus("YOU WIN");
        saveResult("win");
      } else {
        setStatus("DRAW");
        saveResult("draw");
      }

      return;
    }

    setTurn("O");
    setStatus("BOT THINKING...");

    setTimeout(
      function () {
        const botMove =
          getBestBotMove(
            playerBoard,
            "O"
          );

        if (botMove < 0) {
          return;
        }

        const botBoard =
          playerBoard.slice();

        botBoard[botMove] = "O";

        const botResult =
          getWinner(botBoard);

        setBoard(botBoard);

        if (botResult) {
          if (
            botResult === "O"
          ) {
            setStatus(
              "PRO BOT WINS"
            );

            saveResult("loss");
          } else {
            setStatus("DRAW");
            saveResult("draw");
          }

          return;
        }

        setTurn("X");
        setStatus("YOUR TURN");
      },
      350
    );
  }

  /* ============================================================
     CREATE ROOM
  ============================================================ */

  async function createRoom() {
    if (!db || !user) {
      setStatus(
        "Firebase is not ready."
      );
      return;
    }

    try {
      let roomCode =
        generateRoomCode();

      let attempts = 0;

      while (
        attempts < 5
      ) {
        const roomRef =
          doc(
            db,
            "games",
            roomCode
          );

        const existing =
          await getDoc(roomRef);

        if (!existing.exists()) {
          break;
        }

        roomCode =
          generateRoomCode();

        attempts++;
      }

      if (!isValidRoom(roomCode)) {
        setStatus(
          "Could not create room."
        );
        return;
      }

      const roomRef =
        doc(
          db,
          "games",
          roomCode
        );

      await setDoc(
        roomRef,
        {
          board:
            EMPTY_BOARD.slice(),
          turn: "X",
          status: "waiting",
          host: user.uid,
          guest: null,
          result: null,
          createdAt:
            serverTimestamp(),
        }
      );

      setRoom(roomCode);
      setMyMark("X");

      setBoard(
        EMPTY_BOARD.slice()
      );

      setTurn("X");

      setStatus(
        "WAITING FOR OPPONENT"
      );

      setMode("online");
    } catch (error) {
      console.error(
        "Create room error:",
        error
      );

      setStatus(
        "Could not create room."
      );
    }
  }

  /* ============================================================
     JOIN ROOM
  ============================================================ */

  async function joinRoom(
    roomCode
  ) {
    if (!db || !user) {
      setStatus(
        "Firebase is not ready."
      );
      return;
    }

    const cleanRoom =
      (roomCode || room)
        .trim()
        .toUpperCase();

    if (
      !isValidRoom(cleanRoom)
    ) {
      setStatus(
        "ENTER A VALID 6-CHARACTER ROOM CODE"
      );
      return;
    }

    try {
      const roomRef =
        doc(
          db,
          "games",
          cleanRoom
        );

      const snapshot =
        await getDoc(roomRef);

      if (!snapshot.exists()) {
        setStatus(
          "ROOM NOT FOUND"
        );
        return;
      }

      const game =
        snapshot.data();

      if (
        game.host === user.uid
      ) {
        setMyMark("X");
      } else {
        if (
          game.guest &&
          game.guest !== user.uid
        ) {
          setStatus(
            "ROOM FULL"
          );
          return;
        }

        await updateDoc(
          roomRef,
          {
            guest: user.uid,
            status: "playing",
          }
        );

        setMyMark("O");
      }

      setRoom(cleanRoom);

      setBoard(
        Array.isArray(game.board)
          ? game.board
          : EMPTY_BOARD.slice()
      );

      setTurn(
        game.turn || "X"
      );

      setMode("online");

      setStatus(
        "LIVE MATCH"
      );
    } catch (error) {
      console.error(
        "Join room error:",
        error
      );

      setStatus(
        "Unable to join this room."
      );
    }
  }

  /* ============================================================
     ONLINE MOVE
  ============================================================ */

  async function makeOnlineMove(
    index
  ) {
    if (
      !db ||
      !user ||
      !room ||
      !isValidRoom(room)
    ) {
      setStatus(
        "INVALID ROOM"
      );
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
      const roomRef =
        doc(
          db,
          "games",
          room
        );

      const snapshot =
        await getDoc(roomRef);

      if (!snapshot.exists()) {
        setStatus(
          "ROOM NOT FOUND"
        );
        return;
      }

      const game =
        snapshot.data();

      const latestBoard =
        Array.isArray(game.board)
          ? game.board
          : EMPTY_BOARD.slice();

      const latestTurn =
        game.turn || "X";

      if (
        game.status !==
        "playing"
      ) {
        return;
      }

      if (
        latestTurn !== myMark
      ) {
        return;
      }

      if (
        latestBoard[index]
      ) {
        return;
      }

      const nextBoard =
        latestBoard.slice();

      nextBoard[index] =
        myMark;

      const gameResult =
        getWinner(nextBoard);

      let firebaseResult =
        null;

      if (
        gameResult ===
        "draw"
      ) {
        firebaseResult =
          "DRAW";
      } else if (
        gameResult === "X" ||
        gameResult === "O"
      ) {
        firebaseResult =
          gameResult +
          " WINS";
      }

      let nextTurn =
        myMark === "X"
          ? "O"
          : "X";

      if (gameResult) {
        nextTurn =
          myMark;
      }

      await updateDoc(
        roomRef,
        {
          board: nextBoard,
          turn: nextTurn,
          status: gameResult
            ? "done"
            : "playing",
          result:
            firebaseResult,
          lastMove: index,
          lastMoveAt:
            serverTimestamp(),
        }
      );
    } catch (error) {
      console.error(
        "Online move error:",
        error
      );

      setStatus(
        "Move could not be sent."
      );
    }
  }

  /* ============================================================
     REMATCH
  ============================================================ */

  async function rematch() {
    if (mode === "online") {
      if (
        !db ||
        !room ||
        !isValidRoom(room)
      ) {
        setStatus(
          "INVALID ROOM"
        );
        return;
      }

      try {
        await updateDoc(
          doc(
            db,
            "games",
            room
          ),
          {
            board:
              EMPTY_BOARD.slice(),
            turn: "X",
            status: "playing",
            result: null,
            lastMove: null,
          }
        );

        setStatus(
          "NEW ROUND"
        );
      } catch (error) {
        console.error(
          "Rematch error:",
          error
        );

        setStatus(
          "Could not start rematch."
        );
      }

      return;
    }

    setBoard(
      EMPTY_BOARD.slice()
    );

    setTurn("X");
    setStatus("");
  }

  /* ============================================================
     GOOGLE LOGIN
  ============================================================ */

  async function googleLogin() {
    if (!auth) {
      setStatus(
        "Firebase is not configured."
      );
      return;
    }

    try {
      const provider =
        new GoogleAuthProvider();

      if (
        user &&
        user.isAnonymous
      ) {
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

      setStatus(
        "GOOGLE PROFILE SAVED"
      );
    } catch (error) {
      console.error(
        "Google login error:",
        error
      );

      setStatus(
        "Google login failed."
      );
    }
  }

  /* ============================================================
     LEADERBOARD
  ============================================================ */

  async function loadLeaderboard() {
    if (!db) {
      setStatus(
        "Firebase is not configured."
      );
      return;
    }

    try {
      const playersQuery =
        query(
          collection(
            db,
            "players"
          ),
          orderBy(
            "stats.wins",
            "desc"
          ),
          limit(10)
        );

      const snapshot =
        await getDocs(
          playersQuery
        );

      const rows =
        snapshot.docs.map(
          function (item) {
            return item.data();
          }
        );

      setLeaders(rows);
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

  /* ============================================================
     INVITE LINK
  ============================================================ */

  const inviteLink =
    room &&
    isValidRoom(room)
      ? window.location.origin +
        window.location.pathname +
        "?room=" +
        room
      : "";

  function copyInvite() {
    if (!inviteLink) {
      return;
    }

    if (
      !navigator.clipboard
    ) {
      setStatus(
        "Copy is not supported."
      );
      return;
    }

    navigator.clipboard
      .writeText(inviteLink)
      .then(
        function () {
          setCopied(true);

          setTimeout(
            function () {
              setCopied(false);
            },
            1200
          );
        }
      )
      .catch(
        function () {
          setStatus(
            "Could not copy link."
          );
        }
      );
  }

  /* ============================================================
     HOME
  ============================================================ */

  if (mode === "home") {
    return (
      <Home
        name={name}
        setName={setName}
        google={googleLogin}
        stats={stats}
        bot={function () {
          setBoard(
            EMPTY_BOARD.slice()
          );
          setTurn("X");
          setStatus("YOUR TURN");
          setMode("bot");
        }}
        online={function () {
          setRoom("");
          setStatus("");
          setMode("join");
        }}
        leaders={loadLeaderboard}
        status={status}
      />
    );
  }

  /* ============================================================
     LEADERBOARD
  ============================================================ */

  if (mode === "leaders") {
    return (
      <main>
        <Top
          title="LEADERBOARD"
          back={function () {
            setMode("home");
          }}
        />

        <section className="card leaders">
          <h1>
            TOP PLAYERS
          </h1>

          {leaders.length >
          0 ? (
            leaders.map(
              function (
                player,
                index
              ) {
                return (
                  <div
                    className="rank"
                    key={index}
                  >
                    <span>
                      #
                      {index +
                        1}{" "}
                      {player.name ||
                        "PLAYER"}
                    </span>

                    <b>
                      {player.stats
                        ?.wins ||
                        0}{" "}
                      W
                    </b>
                  </div>
                );
              }
            )
          ) : (
            <p>
              NO SAVED PLAYERS YET
            </p>
          )}
        </section>
      </main>
    );
  }

  /* ============================================================
     JOIN SCREEN
  ============================================================ */

  if (mode === "join") {
    return (
      <main>
        <Top
          title="ONLINE MATCH"
          back={function () {
            setMode("home");
          }}
        />

        <section className="card join">
          <div className="glitch">
            ENTER THE ARENA
          </div>

          <input
            value={room}
            maxLength={6}
            onChange={function (
              event
            ) {
              setRoom(
                event.target.value
                  .toUpperCase()
                  .replace(
                    /[^A-Z0-9]/g,
                    ""
                  )
              );
            }}
            placeholder="ROOM CODE"
          />

          <button
            onClick={function () {
              joinRoom();
            }}
          >
            JOIN ROOM
          </button>

          <div className="or">
            OR
          </div>

          <button
            className="alt"
            onClick={
              createRoom
            }
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

  /* ============================================================
     GAME
  ============================================================ */

  return (
    <Game
      title={
        mode === "bot"
          ? "PRO BOT"
          : "ONLINE // " + room
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
      onBack={function () {
        setMode("home");
      }}
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

/* ============================================================
   TOP BAR
============================================================ */

function Top({
  title,
  back,
}) {
  return (
    <header>
      <b>
        ✦ XOX
        <span>NEON</span>
      </b>

      <strong>
        {title}
      </strong>

      <button
        className="back"
        onClick={back}
      >
        ESC
      </button>
    </header>
  );
}

/* ============================================================
   HOME
============================================================ */

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
          ✦ XOX
          <span>NEON</span>
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
          OUTPLAY. OUTTHINK.
          DOMINATE.
        </p>

        <div className="buttons">
          <button
            onClick={bot}
          >
            ⚡ PRO BOT
          </button>

          <button
            onClick={online}
          >
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
            onChange={function (
              event
            ) {
              setName(
                event.target.value
              );
            }}
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
            <b>
              {stats.wins}
            </b>

            <small>
              WINS
            </small>
          </div>

          <div>
            <b>
              {stats.losses}
            </b>

            <small>
              LOSSES
            </small>
          </div>

          <div>
            <b>
              {stats.draws}
            </b>

            <small>
              DRAWS
            </small>
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

/* ============================================================
   GAME
============================================================ */

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
            TURN{" "}
            <b>{turn}</b>
          </span>
        </div>

        <div className="board">
          {board.map(
            function (
              value,
              index
            ) {
              return (
                <button
                  key={index}
                  disabled={
                    !!value ||
                    !!result
                  }
                  onClick={function () {
                    onCell(index);
                  }}
                  className={
                    value
                      ? "cell " +
                        value.toLowerCase()
                      : "cell"
                  }
                >
                  {value}
                </button>
              );
            }
          )}
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
