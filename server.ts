import type { PartyKitServer, Party } from "partykit";

interface MatchStart {
  type: "matchStart";
  matchId: string;
  youAre: 0 | 1;
}

interface Relay {
  type: "relay";
  matchId: string;
  payload: unknown;
}

interface Chat {
  type: "chat";
  matchId: string;
  message: { id: string; name: string; text: string; ts: number };
}

const LOBBY_ID = "lobby";

export default class Server implements PartyKitServer {
  waiting: string | null = null;

  onConnect(conn: Party.Connection, room: Party) {
    if (room.id !== LOBBY_ID) return;

    if (!this.waiting || this.waiting === conn.id) {
      this.waiting = conn.id;
      conn.send(JSON.stringify({ type: "status", message: "Waiting for an opponent…" }));
    } else {
      const opponentId = this.waiting;
      this.waiting = null;

      const matchId = crypto.randomUUID();
      const roles: [string, string] = Math.random() < 0.5 ? [conn.id, opponentId] : [opponentId, conn.id];

      const player0 = room.getConnection(roles[0]);
      const player1 = room.getConnection(roles[1]);

      const to0: MatchStart = { type: "matchStart", matchId, youAre: 0 };
      const to1: MatchStart = { type: "matchStart", matchId, youAre: 1 };

      player0?.send(JSON.stringify(to0));
      player1?.send(JSON.stringify(to1));
    }
  }

  onMessage(msg: string, conn: Party.Connection, room: Party) {
    try {
      const data = JSON.parse(msg);

      if (room.id !== LOBBY_ID) {
        if (data.type === "relay") {
          const r: Relay = data;
          room.getConnections().forEach((c) => {
            if (c.id !== conn.id) c.send(JSON.stringify(r));
          });
          return;
        }
        if (data.type === "chat") {
          const c: Chat = data;
          room.broadcast(JSON.stringify(c));
          return;
        }
      }
    } catch (e) {}
  }
}

export const onRequest: PartyKitServer["onRequest"] = async () => {
  return new Response("OK");
};
