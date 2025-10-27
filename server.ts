import type { PartyKitServer, Party } from "partykit";

interface MatchStart {
  type: "matchStart";
  matchId: string;
  youAre: 0 | 1;
}

interface Relay {
  type: "relay";
  matchId?: string;
  payload: any;
}

interface Chat {
  type: "chat";
  matchId?: string;
  message: { id: string; name: string; text: string; ts: number };
}

interface GameOver {
  type: "gameOver";
  reason: string;
  finalScore?: string;
}

const LOBBY_ID = "lobby";
const matchScores = new Map<string, [number, number]>();
const matchTimeouts = new Map<string, NodeJS.Timeout>();

const server: PartyKitServer = {
  waiting: null as string | null,

  async onConnect(conn, room) {
    console.log("⚡️ Connected", { roomId: room.id, connId: conn.id });

    if (!room.id?.endsWith(LOBBY_ID)) return;

    if (!this.waiting || this.waiting === conn.id) {
      this.waiting = conn.id;
      conn.send(JSON.stringify({ type: "status", message: "Waiting for an opponent…" }));
      console.log("🕹️ Waiting player:", conn.id);
    } else {
      const opponentId = this.waiting;
      this.waiting = null;

      const matchId = crypto.randomUUID();
      matchScores.set(matchId, [0, 0]);

      const roles: [string, string] =
        Math.random() < 0.5 ? [conn.id, opponentId] : [opponentId, conn.id];

      const p0 = room.getConnection(roles[0]);
      const p1 = room.getConnection(roles[1]);

      console.log("🎮 Starting match:", matchId, "Players:", roles);

      const to0: MatchStart = { type: "matchStart", matchId, youAre: 0 };
      const to1: MatchStart = { type: "matchStart", matchId, youAre: 1 };

      p0?.send(JSON.stringify(to0));
      p1?.send(JSON.stringify(to1));
    }
  },

  async onMessage(msg, conn, room) {
    try {
      const data = JSON.parse(msg);
      if (!room.id || room.id.endsWith(LOBBY_ID)) return;

      // reset cleanup timer whenever there's activity
      resetCleanupTimer(room.id);

      if (data.type === "relay" && data.payload?.scores) {
        matchScores.set(room.id, data.payload.scores);
      }

      if (data.type === "relay") {
        for (const c of [...room.getConnections()]) {
          if (c.id !== conn.id) c.send(msg);
        }
        return;
      }

      if (data.type === "chat") {
        for (const c of [...room.getConnections()]) c.send(msg);
        return;
      }
    } catch (err) {
      console.error("❌ Error handling message:", err);
    }
  },

  async onClose(conn, room) {
    console.log("💨 Player disconnected:", conn.id, "from", room.id);
    if (!room.id || room.id.endsWith(LOBBY_ID)) return;

    const others = [...room.getConnections()].filter((c) => c.id !== conn.id);
    const score = matchScores.get(room.id) || ["?", "?"];

    for (const other of others) {
      const msg: GameOver = {
        type: "gameOver",
        reason: "Player forfeited",
        finalScore: `${score[0]} - ${score[1]}`,
      };
      console.log("📤 Sending gameOver to:", other.id, msg.finalScore);
      other.send(JSON.stringify(msg));
    }

    scheduleCleanup(room.id);
  },

  async onRequest() {
    return new Response("OK");
  },
};

// 🧹 Schedules automatic match cleanup
function scheduleCleanup(matchId: string) {
  if (matchTimeouts.has(matchId)) clearTimeout(matchTimeouts.get(matchId)!);

  const timeout = setTimeout(() => {
    console.log("🧹 Cleaning up inactive match:", matchId);
    matchScores.delete(matchId);
    matchTimeouts.delete(matchId);
  }, 30_000); // 30 seconds

  matchTimeouts.set(matchId, timeout);
}

// 🧼 Resets cleanup timer if new activity arrives
function resetCleanupTimer(matchId: string) {
  if (matchTimeouts.has(matchId)) {
    clearTimeout(matchTimeouts.get(matchId)!);
    scheduleCleanup(matchId);
  }
}

export default server;
