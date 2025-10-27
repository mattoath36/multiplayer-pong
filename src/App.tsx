import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";

// PartyKit host injected by Netlify environment variable
const HOST = import.meta.env.VITE_PARTYKIT_HOST as string;
const WIDTH = 800;
const HEIGHT = 600;
const PADDLE_H = 80;
const BALL_SIZE = 10;

// linear interpolation helper
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

interface GameState {
  paddles: [number, number];
  ball: { x: number; y: number; vx: number; vy: number };
  scores: [number, number];
  status: "waiting" | "playing" | "gameover";
  message?: string;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [game, setGame] = useState<GameState>({
    paddles: [HEIGHT / 2 - PADDLE_H / 2, HEIGHT / 2 - PADDLE_H / 2],
    ball: { x: WIDTH / 2, y: HEIGHT / 2, vx: 4, vy: 3 },
    scores: [0, 0],
    status: "waiting",
    message: "Waiting for opponent...",
  });

const [chat, setChat] = useState<{ id: string; name: string; text: string; ts?: number }[]>([]);
  const [input, setInput] = useState("");

  const lobby = useRef<PartySocket | null>(null);
  const match = useRef<PartySocket | null>(null);
  const me = useRef<number | null>(null);
  const opponentRef = useRef<number | null>(null);

  const networkPaddles = useRef<[number, number] | null>(null);
  const lastSent = useRef<number | null>(null);
  const keys = useRef({ up: false, down: false });

  // --- SETUP LOBBY CONNECTION ---
  useEffect(() => {
    const s = new PartySocket({ host: HOST, room: "lobby" });
    lobby.current = s;

    s.addEventListener("open", () => {
      console.log("🛰 Connected to lobby");
    });

    s.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "status") {
        setGame((g) => ({ ...g, message: data.message }));
      }
      if (data.type === "matchStart") {
        const { matchId, youAre } = data;
        console.log("🎮 Match starting:", matchId, "You are:", youAre);
        me.current = youAre;
        opponentRef.current = youAre === 0 ? 1 : 0;

        const ms = new PartySocket({ host: HOST, room: matchId });
        match.current = ms;

        setGame((g) => ({ ...g, status: "playing", message: undefined }));

        ms.addEventListener("message", (e) => {
          const d = JSON.parse(e.data);

          if (d.type === "relay" && d.payload?.paddles) {
            networkPaddles.current = d.payload.paddles;
          }

          if (d.type === "relay" && d.payload?.ball) {
            setGame((g) => ({ ...g, ball: d.payload.ball }));
          }

          if (d.type === "chat") {
            setChat((prev) => [...prev, d.message]);
          }

          if (d.type === "gameOver") {
            setGame((g) => ({
              ...g,
              status: "gameover",
              message: `${d.reason}, final score ${d.finalScore}`,
            }));
          }
        });
      }
    });

    return () => s.close();
  }, []);

  // --- INPUT HANDLING ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (me.current === null || game.status !== "playing") return;
      const isDown = e.type === "keydown";
      if (e.key === "ArrowUp") keys.current.up = isDown;
      if (e.key === "ArrowDown") keys.current.down = isDown;
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [game.status]);

  // --- GAME LOOP ---
  useEffect(() => {
    let frame: number;

    const loop = () => {
      if (game.status === "playing") {
        setGame((g) => {
          const newP = [...g.paddles] as [number, number];
          const newBall = { ...g.ball };
          const myIndex = me.current;
          const oppIndex = opponentRef.current;

          // LOCAL MOVEMENT (instant + clamp)
          if (myIndex !== null) {
            if (keys.current.up) newP[myIndex] -= 6;
            if (keys.current.down) newP[myIndex] += 6;
            newP[myIndex] = Math.max(0, Math.min(HEIGHT - PADDLE_H, newP[myIndex]));

            // Send paddle updates ~20fps
            const now = Date.now();
            if (!lastSent.current || now - lastSent.current > 50) {
              lastSent.current = now;
              match.current?.send(
                JSON.stringify({ type: "relay", payload: { paddles: newP } })
              );
            }
          }

          // REMOTE SMOOTHING
          if (oppIndex !== null && networkPaddles.current) {
            const target = networkPaddles.current[oppIndex];
            newP[oppIndex] = lerp(g.paddles[oppIndex], target, 0.2);
          }

          // BALL PHYSICS (host only)
          if (myIndex === 0) {
            newBall.x += newBall.vx;
            newBall.y += newBall.vy;

            if (newBall.y < 0 || newBall.y > HEIGHT - BALL_SIZE) {
              newBall.vy *= -1;
            }

            // Paddle collisions
            if (
              newBall.x < 20 &&
              newBall.y > newP[0] &&
              newBall.y < newP[0] + PADDLE_H
            ) {
              newBall.vx *= -1;
            }
            if (
              newBall.x > WIDTH - 30 &&
              newBall.y > newP[1] &&
              newBall.y < newP[1] + PADDLE_H
            ) {
              newBall.vx *= -1;
            }

            // Send ball updates occasionally
            if (!lastSent.current || Date.now() - lastSent.current > 50) {
              match.current?.send(
                JSON.stringify({ type: "relay", payload: { ball: newBall } })
              );
            }
          }

          return { ...g, paddles: newP, ball: newBall };
        });
      }
      draw();
      frame = requestAnimationFrame(loop);
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      ctx.fillStyle = "white";
      ctx.fillRect(10, game.paddles[0], 10, PADDLE_H);
      ctx.fillRect(WIDTH - 20, game.paddles[1], 10, PADDLE_H);

      ctx.beginPath();
      ctx.arc(game.ball.x, game.ball.y, BALL_SIZE, 0, Math.PI * 2);
      ctx.fill();
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [game.status]);

  // --- CHAT ---
  const sendChat = () => {
    if (!input.trim()) return;
    const msg = { id: crypto.randomUUID(), name: "Player", text: input, ts: Date.now() };
    setChat((prev) => [...prev, msg]);
    match.current?.send(JSON.stringify({ type: "chat", message: msg }));
    setInput("");
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-white gap-3">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="border border-gray-700 rounded"
      />
      <div className="text-center text-lg font-mono">
        {game.message && <p>{game.message}</p>}
      </div>
      {game.status === "gameover" && (
        <button
          className="bg-blue-500 px-4 py-2 rounded"
          onClick={() => window.location.reload()}
        >
          Rematch
        </button>
      )}
      <div className="flex gap-2 mt-4">
        <input
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 w-64"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send emoji or chat..."
        />
        <button
          className="bg-green-600 px-3 py-1 rounded"
          onClick={sendChat}
        >
          Send
        </button>
      </div>
      <div className="mt-2 w-80 h-32 overflow-y-auto text-sm text-left bg-gray-800 rounded p-2 border border-gray-700">
        {chat.map((c) => (
          <p key={c.id}>
            <b>{c.name}:</b> {c.text}
          </p>
        ))}
      </div>
    </div>
  );
}
