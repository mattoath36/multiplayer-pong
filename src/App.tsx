import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";

const HOST = import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";

const WIDTH = 600;
const HEIGHT = 400;
const PADDLE_H = 60;
const PADDLE_W = 10;
const BALL_R = 8;

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
interface GameState {
  paddles: [number, number];
  ball: Ball;
  scores: [number, number];
  status: "waiting" | "playing" | "over";
  message: string;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lobby = useRef<PartySocket | null>(null);
  const match = useRef<PartySocket | null>(null);
  const me = useRef<0 | 1 | null>(null);

  const [game, setGame] = useState<GameState>({
    paddles: [HEIGHT / 2 - PADDLE_H / 2, HEIGHT / 2 - PADDLE_H / 2],
    ball: { x: WIDTH / 2, y: HEIGHT / 2, vx: 4, vy: 3 },
    scores: [0, 0],
    status: "waiting",
    message: "Connecting...",
  });

  const [chat, setChat] = useState<{ name: string; text: string }[]>([]);
  const [input, setInput] = useState("");

  // --- Connect to lobby (run once) ---
  useEffect(() => {
    console.log("🛰 Connecting to:", HOST);
    const s = new PartySocket({ host: HOST, room: "lobby" });
    lobby.current = s;

    s.addEventListener("open", () => {
      console.log("✅ Connected to lobby");
      setGame((g) => ({ ...g, message: "Waiting for an opponent..." }));
    });

    s.addEventListener("message", (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "matchStart") {
        me.current = data.youAre;
        joinMatch(data.matchId);
      } else if (data.type === "status") {
        setGame((g) => ({ ...g, message: data.message }));
      }
    });

    return () => s.close();
  }, []);

  // --- Join match ---
  function joinMatch(id: string) {
    console.log("🎮 Joining match:", id);
    const ms = new PartySocket({ host: HOST, room: id });
    match.current = ms;
    setGame((g) => ({
      ...g,
      status: "playing",
      message: "Match started! Use ↑/↓ to move.",
    }));

    ms.addEventListener("open", () =>
      console.log("✅ Connected to match:", id)
    );

    ms.addEventListener("message", (e) => {
      const data = JSON.parse(e.data);

      if (data.type === "relay" && data.payload) {
        setGame((g) => ({ ...g, ...data.payload }));
      }

      if (data.type === "chat") {
        setChat((c) => [...c, data.message]);
      }

      if (data.type === "gameOver") {
        setGame((g) => ({
          ...g,
          status: "over",
          message: `${data.reason}, final score ${data.finalScore || "N/A"}`,
        }));
      }
    });

    ms.addEventListener("close", () => {
      setGame((g) => ({
        ...g,
        status: "over",
        message: "Connection lost.",
      }));
    });
  }

  // --- Keyboard controls (run once) ---
  useEffect(() => {
    const keys = { up: false, down: false };
    const onKey = (e: KeyboardEvent) => {
      if (game.status !== "playing" || me.current === null) return;
      const isDown = e.type === "keydown";
      if (e.key === "ArrowUp") keys.up = isDown;
      if (e.key === "ArrowDown") keys.down = isDown;
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    const interval = setInterval(() => {
      if (me.current === null || game.status !== "playing") return;

      setGame((g) => {
        const newP = [...g.paddles] as [number, number];
        if (keys.up) newP[me.current] -= 6;
        if (keys.down) newP[me.current] += 6;
        const updated = { ...g, paddles: newP };
        match.current?.send(
          JSON.stringify({ type: "relay", payload: { paddles: newP } })
        );
        return updated;
      });
    }, 16);

    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [game.status]);

  // --- Game physics loop (hosted on player 0) ---
  useEffect(() => {
    if (me.current !== 0) return; // only player 0 drives ball
    const loop = setInterval(() => {
      setGame((g) => {
        if (g.status !== "playing") return g;
        let { ball, paddles, scores } = g;
        let { x, y, vx, vy } = ball;

        x += vx;
        y += vy;

        if (y < BALL_R || y > HEIGHT - BALL_R) vy *= -1;

        // Paddle collisions
        if (
          x < 20 + PADDLE_W &&
          y > paddles[0] &&
          y < paddles[0] + PADDLE_H &&
          vx < 0
        )
          vx *= -1;

        if (
          x > WIDTH - 20 - PADDLE_W &&
          y > paddles[1] &&
          y < paddles[1] + PADDLE_H &&
          vx > 0
        )
          vx *= -1;

        // Score conditions
        if (x < 0) {
          scores = [scores[0], scores[1] + 1];
          x = WIDTH / 2;
          y = HEIGHT / 2;
          vx = 4;
        }
        if (x > WIDTH) {
          scores = [scores[0] + 1, scores[1]];
          x = WIDTH / 2;
          y = HEIGHT / 2;
          vx = -4;
        }

        const newState = {
          ...g,
          ball: { x, y, vx, vy },
          scores,
        };
        match.current?.send(
          JSON.stringify({ type: "relay", payload: newState })
        );
        return newState;
      });
    }, 16);

    return () => clearInterval(loop);
  }, [game.status]);

  // --- Draw frame ---
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "white";
    // paddles
    ctx.fillRect(10, game.paddles[0], PADDLE_W, PADDLE_H);
    ctx.fillRect(WIDTH - 20, game.paddles[1], PADDLE_W, PADDLE_H);
    // ball
    ctx.beginPath();
    ctx.arc(game.ball.x, game.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    // score
    ctx.font = "20px Arial";
    ctx.fillText(game.scores[0].toString(), WIDTH * 0.25, 30);
    ctx.fillText(game.scores[1].toString(), WIDTH * 0.75, 30);
  }, [game]);

  // --- Chat ---
  function sendChat() {
    if (!input.trim()) return;
    const msg = {
      id: crypto.randomUUID(),
      name: `P${me.current ?? "?"}`,
      text: input,
      ts: Date.now(),
    };
    match.current?.send(JSON.stringify({ type: "chat", message: msg }));
    setChat((c) => [...c, msg]);
    setInput("");
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-white relative">
      <h1 className="text-2xl mb-2">🏓 Party Pong</h1>
      <p className="mb-4">{game.message}</p>

      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="border border-gray-600 bg-black"
      ></canvas>

      {/* Chat */}
      <div className="mt-4 w-96 bg-gray-800 rounded-xl p-2 flex flex-col h-40">
        <div className="flex-1 overflow-y-auto text-sm">
          {chat.map((c, i) => (
            <div key={i}>
              <span className="font-bold">{c.name}:</span> {c.text}
            </div>
          ))}
        </div>
        <div className="flex mt-2">
          <input
            className="flex-1 bg-gray-700 p-1 rounded-l text-sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Say hi or drop an emoji…"
          />
          <button
            className="bg-white text-black px-3 rounded-r"
            onClick={sendChat}
          >
            Send
          </button>
        </div>
      </div>

      {game.status === "over" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white text-2xl">
          <p>{game.message}</p>
          <button
            className="mt-4 bg-white text-black px-4 py-2 rounded-xl"
            onClick={() => window.location.reload()}
          >
            Back to Lobby
          </button>
        </div>
      )}
    </div>
  );
}
