import { useEffect, useRef, useState } from "react";
import { PartySocket } from "partysocket";

const HOST = import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";

type MatchStart = { type: "matchStart"; matchId: string; youAre: 0 | 1 };
type Relay<T = any> = { type: "relay"; matchId: string; payload: T };
type ChatMsg = { id: string; name: string; text: string; ts: number };
type ChatWire = { type: "chat"; matchId: string; message: ChatMsg };

const W = 800;
const H = 500;
const PADDLE_W = 12;
const PADDLE_H = 100;
const BALL_R = 8;
const PADDLE_SPEED = 7;
const TICK_MS = 1000 / 60;

interface State {
  p0: number;
  p1: number;
  ball: { x: number; y: number; vx: number; vy: number };
  score: [number, number];
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function newBall(dir: 1 | -1) {
  const angle = (Math.random() * 0.6 - 0.3) * Math.PI;
  const speed = 6;
  return {
    x: W / 2,
    y: H / 2,
    vx: dir * speed * Math.cos(angle),
    vy: speed * Math.sin(angle),
  };
}

export default function App() {
  const [status, setStatus] = useState("Connecting to lobby…");
  const [name, setName] = useState(() => localStorage.getItem("name") || "Player");
  const [emojiBar] = useState(["😀", "😎", "🔥", "💥", "🏓", "🎉", "👏", "💯", "🤝", "🥳"]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");

  const lobby = useRef<PartySocket | null>(null);
  const match = useRef<PartySocket | null>(null);

  const me = useRef<0 | 1 | null>(null);
  const matchId = useRef<string | null>(null);

  const state = useRef<State>({
    p0: H / 2 - PADDLE_H / 2,
    p1: H / 2 - PADDLE_H / 2,
    ball: newBall(Math.random() < 0.5 ? 1 : -1),
    score: [0, 0],
  });

  const keys = useRef({ up: false, down: false });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Connect to lobby on mount
  useEffect(() => {
    const s = new PartySocket({ host: HOST, room: "lobby" });
    lobby.current = s;

    s.addEventListener("message", (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "status") setStatus(data.message);
      if (data.type === "matchStart") {
        const m = data as MatchStart;
        me.current = m.youAre;
        matchId.current = m.matchId;
        setStatus("Opponent found! Joining match…");
        s.close();
        joinMatch(m.matchId);
      }
    });

    s.addEventListener("open", () => setStatus("Waiting for an opponent…"));
    return () => s.close();
  }, []);

  function joinMatch(id: string) {
    const ms = new PartySocket({ host: HOST, room: id });
    match.current = ms;
    setStatus("Match started! Use ↑/↓ to move.");

    ms.addEventListener("message", (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "relay") {
        const r = data as Relay;
        const p = r.payload as Partial<State> & { event?: string };
        if (p.p0 !== undefined) state.current.p0 = p.p0;
        if (p.p1 !== undefined) state.current.p1 = p.p1;
        if (p.ball) state.current.ball = p.ball as State["ball"];
        if (p.score) state.current.score = p.score as [number, number];
      }
      if (data.type === "chat") {
        const { message } = data as ChatWire;
        setChat((c) => [...c, message]);
      }
    });
  }

  // Controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") keys.current.up = e.type === "keydown";
      if (e.key === "ArrowDown") keys.current.down = e.type === "keydown";
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // Game loop
  useEffect(() => {
    let last = performance.now();
    let acc = 0;
    const ctx = canvasRef.current?.getContext("2d");

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      acc += dt;
      while (acc >= TICK_MS) {
        step();
        acc -= TICK_MS;
      }
      render(ctx!);
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, []);

  function step() {
    const s = state.current;
    if (me.current === 0) {
      if (keys.current.up) s.p0 -= PADDLE_SPEED;
      if (keys.current.down) s.p0 += PADDLE_SPEED;
      s.p0 = clamp(s.p0, 0, H - PADDLE_H);
    } else if (me.current === 1) {
      if (keys.current.up) s.p1 -= PADDLE_SPEED;
      if (keys.current.down) s.p1 += PADDLE_SPEED;
      s.p1 = clamp(s.p1, 0, H - PADDLE_H);
    }

    if (me.current === 0 && match.current?.readyState === 1) {
      const b = s.ball;
      b.x += b.vx;
      b.y += b.vy;

      if (b.y < BALL_R || b.y > H - BALL_R) b.vy *= -1;

      const leftRect = { x: 20, y: s.p0, w: PADDLE_W, h: PADDLE_H };
      const rightRect = { x: W - 20 - PADDLE_W, y: s.p1, w: PADDLE_W, h: PADDLE_H };

      if (
        b.x - BALL_R < leftRect.x + leftRect.w &&
        b.y > leftRect.y &&
        b.y < leftRect.y + leftRect.h &&
        b.vx < 0
      ) {
        b.vx *= -1;
        const rel = (b.y - (leftRect.y + leftRect.h / 2)) / (leftRect.h / 2);
        b.vy = rel * 6;
      }

      if (
        b.x + BALL_R > rightRect.x &&
        b.y > rightRect.y &&
        b.y < rightRect.y + rightRect.h &&
        b.vx > 0
      ) {
        b.vx *= -1;
        const rel = (b.y - (rightRect.y + rightRect.h / 2)) / (rightRect.h / 2);
        b.vy = rel * 6;
      }

      if (b.x < 0 - 40) {
        s.score[1] += 1;
        s.ball = newBall(1);
      }
      if (b.x > W + 40) {
        s.score[0] += 1;
        s.ball = newBall(-1);
      }

      const payload: Partial<State> = { p0: s.p0, p1: s.p1, ball: s.ball, score: s.score };
      const msg: Relay = { type: "relay", matchId: matchId.current!, payload };
      match.current?.send(JSON.stringify(msg));
    }

    if (me.current === 1 && match.current?.readyState === 1) {
      const payload: Partial<State> = { p1: state.current.p1 };
      const msg: Relay = { type: "relay", matchId: matchId.current!, payload };
      match.current?.send(JSON.stringify(msg));
    }
  }

  function render(ctx: CanvasRenderingContext2D) {
    const s = state.current;
    ctx.clearRect(0, 0, W, H);

    ctx.globalAlpha = 0.25;
    for (let y = 0; y < H; y += 30) ctx.fillRect(W / 2 - 2, y, 4, 20);
    ctx.globalAlpha = 1;

    ctx.fillRect(20, s.p0, PADDLE_W, PADDLE_H);
    ctx.fillRect(W - 20 - PADDLE_W, s.p1, PADDLE_W, PADDLE_H);

    ctx.beginPath();
    ctx.arc(s.ball.x, s.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "28px ui-sans-serif, system-ui, -apple-system";
    ctx.textAlign = "center";
    ctx.fillText(String(s.score[0]), W * 0.25, 40);
    ctx.fillText(String(s.score[1]), W * 0.75, 40);
  }

  function sendChat(text: string) {
    if (!text.trim() || !match.current) return;
    const msg: ChatWire = {
      type: "chat",
      matchId: matchId.current!,
      message: { id: crypto.randomUUID(), name, text, ts: Date.now() },
    };
    match.current.send(JSON.stringify(msg));
    setChat((c) => [...c, msg.message]);
  }

  return (
    <div className="wrap">
      <div className="sidebar">
        <h1>Party Pong 🏓</h1>
        <p className="status">{status}</p>

        <label className="row">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              localStorage.setItem("name", e.target.value);
            }}
            placeholder="Your name"
          />
        </label>

        <div className="chat">
          <div className="history">
            {chat.map((m) => (
              <div className="msg" key={m.id}>
                <span className="who">{m.name}</span>
                <span className="text">{m.text}</span>
              </div>
            ))}
          </div>
          <div className="emoji-bar">
            {emojiBar.map((e) => (
              <button key={e} onClick={() => sendChat(e)} title={e}>
                {e}
              </button>
            ))}
          </div>
          <div className="composer">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  sendChat(input);
                  setInput("");
                }
              }}
              placeholder="Type a message or use emojis…"
            />
            <button
              onClick={() => {
                sendChat(input);
                setInput("");
              }}
            >
              Send
            </button>
          </div>
        </div>

        <div className="help">
          <p>
            <strong>Controls:</strong> ↑ / ↓ keys
          </p>
          <p>
            <strong>Tip:</strong> Open this page in two tabs to test multiplayer.
          </p>
        </div>
      </div>

      <div className="stage">
        <canvas ref={canvasRef} width={W} height={H} />
      </div>
    </div>
  );
}
