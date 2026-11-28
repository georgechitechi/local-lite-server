import crypto from 'node:crypto';
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import type { SqlExecutor, SyncChangeEvent, SyncEventBroker } from 'local-lite/server';
import type { CommandRuntime } from '../commands/index.js';
import {
  getLensDeltas,
  matchesLensEvent,
  type LensRegistry,
} from '../db/lenses.js';
import type { RulesDictionary } from '../db/rules.js';
import type { SchemaDictionary } from '../db/schema.js';
import type { AuthContext, ResolvedAuth } from './authContext.js';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function encodeWsFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

export function decodeWsFrames(buf: Buffer): {
  frames: Array<{ opcode: number; payload: Buffer }>;
  rest: Buffer;
} {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let offset = 0;

  while (offset + 2 <= buf.length) {
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let pos = offset + 2;

    if (len === 126) {
      if (pos + 2 > buf.length) break;
      len = buf.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (pos + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(pos));
      pos += 8;
    }

    const maskLen = masked ? 4 : 0;
    if (pos + maskLen + len > buf.length) break;

    let payload = buf.subarray(pos + maskLen, pos + maskLen + len);
    if (masked) {
      const mask = buf.subarray(pos, pos + 4);
      const unmasked = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) {
        unmasked[i] = payload[i] ^ mask[i & 3];
      }
      payload = unmasked;
    }

    frames.push({ opcode, payload });
    offset = pos + maskLen + len;
  }

  return { frames, rest: buf.subarray(offset) };
}

export class PresenceHub {
  private rooms = new Map<
    string,
    Map<string, { state: unknown; send: (msg: unknown) => void }>
  >();

  join(
    room: string,
    clientId: string,
    state: unknown,
    send: (msg: unknown) => void,
  ) {
    let members = this.rooms.get(room);
    if (!members) {
      members = new Map();
      this.rooms.set(room, members);
    }
    members.set(clientId, { state, send });
    this.emitState(room);
  }

  leave(room: string, clientId: string) {
    const members = this.rooms.get(room);
    if (!members) return;
    if (members.delete(clientId)) {
      if (members.size === 0) this.rooms.delete(room);
      else this.emitState(room);
    }
  }

  leaveAll(clientId: string) {
    for (const room of [...this.rooms.keys()]) {
      this.leave(room, clientId);
    }
  }

  broadcast(room: string, fromClientId: string, event: string, data: unknown) {
    const members = this.rooms.get(room);
    if (!members) return;
    for (const [id, m] of members) {
      if (id !== fromClientId) {
        m.send({ type: 'presence.event', room, from: fromClientId, event, data });
      }
    }
  }

  private emitState(room: string) {
    const members = this.rooms.get(room);
    if (!members) return;
    const snapshot = [...members.entries()].map(([id, m]) => ({
      clientId: id,
      state: m.state,
    }));
    for (const m of members.values()) {
      m.send({ type: 'presence.state', room, members: snapshot });
    }
  }
}

export function createWsUpgradeHandler(deps: {
  authCtx: AuthContext;
  db: SqlExecutor;
  schema: SchemaDictionary;
  rules: RulesDictionary;
  lenses: LensRegistry;
  broker: SyncEventBroker;
  cmdRuntime: CommandRuntime;
  presence?: PresenceHub;
}) {
  const { authCtx, db, schema, rules, lenses, broker, cmdRuntime } = deps;
  const presence = deps.presence ?? new PresenceHub();

  return async (
    req: http.IncomingMessage,
    socket: Duplex,
    _head: Buffer,
  ): Promise<void> => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key || Array.isArray(key)) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64');

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );

    const clientId = crypto.randomUUID();
    const sendJson = (obj: unknown) => {
      if (socket.destroyed) return;
      socket.write(encodeWsFrame(0x1, Buffer.from(JSON.stringify(obj))));
    };

    // Attempt header/query auth upfront; also allow explicit `{ type: 'auth', token }` frame.
    let connAuth: ResolvedAuth | null = await authCtx
      .resolveAuth(
        new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/ws'}`, {
          headers: req.headers as Record<string, string>,
        }),
        true,
      )
      .catch(() => null);

    if (connAuth) {
      sendJson({ type: 'ready', clientId });
    }

    interface LensSub {
      id: string;
      lensName: string;
      args: Record<string, unknown>;
      cursor: number;
      filterCols: string[];
      table: string;
      columns?: string[];
      timer: ReturnType<typeof setTimeout> | null;
    }
    const subs = new Map<string, LensSub>();

    const flushSub = async (sub: LensSub) => {
      sub.timer = null;
      if (!connAuth || socket.destroyed) return;
      const lens = lenses.get(sub.lensName);
      if (!lens) return;
      try {
        const next = await getLensDeltas({
          db,
          schema,
          rules,
          lens,
          args: sub.args,
          since: sub.cursor,
          auth: connAuth,
        });
        if (next.cursor > sub.cursor) sub.cursor = next.cursor;
        if (next.changes.changes.length > 0 || next.resyncRequired) {
          sendJson({ type: 'deltas', id: sub.id, ...next });
        }
      } catch (err) {
        sendJson({
          type: 'error',
          id: sub.id,
          message: err instanceof Error ? err.message : 'Lens sync failed.',
        });
      }
    };

    const unsubBroker = broker.subscribe((ev: SyncChangeEvent) => {
      for (const sub of subs.values()) {
        if (
          !matchesLensEvent(
            { table: sub.table, columns: sub.columns },
            sub.filterCols,
            ev,
          )
        ) {
          continue;
        }
        if (!sub.timer) {
          sub.timer = setTimeout(() => void flushSub(sub), 15);
        }
      }
    });

    const handleMessage = async (msg: Record<string, any>) => {
      const type = String(msg.type ?? '');
      if (type === 'ping') {
        sendJson({ type: 'pong' });
        return;
      }

      if (type === 'auth') {
        const token = typeof msg.token === 'string' ? msg.token : '';
        connAuth = await authCtx.resolveAuth(
          new Request('http://localhost/ws', {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }),
        );
        if (!connAuth) {
          sendJson({ type: 'error', message: 'Unauthorized' });
          return;
        }
        sendJson({ type: 'ready', clientId });
        return;
      }

      if (!connAuth) {
        sendJson({ type: 'error', reqId: msg.reqId, message: 'Unauthorized' });
        return;
      }

      if (type === 'subscribeLens') {
        const id = String(msg.id ?? '');
        const lensName = String(msg.lens ?? '');
        const lens = lenses.get(lensName);
        if (!id || !lens) {
          sendJson({
            type: 'error',
            id,
            message: `Lens "${lensName}" not found.`,
          });
          return;
        }
        const args =
          msg.args && typeof msg.args === 'object' ? msg.args : {};
        const since = Number(msg.since ?? 0);
        const filterCols = lens.where
          ? Object.keys(await lens.where({ auth: connAuth }, args))
          : [];
        const initial = await getLensDeltas({
          db,
          schema,
          rules,
          lens,
          args,
          since,
          auth: connAuth,
        });
        subs.set(id, {
          id,
          lensName,
          args,
          cursor: initial.cursor,
          filterCols,
          table: lens.table,
          columns: lens.columns,
          timer: null,
        });
        sendJson({ type: 'deltas', id, ...initial });
        return;
      }

      if (type === 'unsubscribeLens') {
        const id = String(msg.id ?? '');
        const existing = subs.get(id);
        if (existing?.timer) clearTimeout(existing.timer);
        subs.delete(id);
        return;
      }

      if (type === 'call') {
        const reqId = msg.reqId;
        const cmd = String(msg.cmd ?? '');
        const args =
          msg.args && typeof msg.args === 'object' ? msg.args : {};
        const idempotencyKey =
          typeof msg.idempotencyKey === 'string'
            ? msg.idempotencyKey
            : undefined;
        try {
          const runRes = await cmdRuntime.run(cmd, args, connAuth, {
            idempotencyKey,
          });
          sendJson({ type: 'commandResult', reqId, ...runRes });
        } catch (err) {
          sendJson({
            type: 'error',
            reqId,
            message: err instanceof Error ? err.message : 'Command failed.',
          });
        }
        return;
      }

      if (type === 'presence.join') {
        const room = String(msg.room ?? '').trim();
        if (room) presence.join(room, clientId, msg.state ?? {}, sendJson);
        return;
      }
      if (type === 'presence.leave') {
        const room = String(msg.room ?? '').trim();
        if (room) presence.leave(room, clientId);
        return;
      }
      if (type === 'presence.broadcast') {
        const room = String(msg.room ?? '').trim();
        if (room) {
          presence.broadcast(
            room,
            clientId,
            String(msg.event ?? 'message'),
            msg.data,
          );
        }
      }
    };

    let buffer: Buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { frames, rest } = decodeWsFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame.opcode === 0x8) {
          socket.end(encodeWsFrame(0x8, Buffer.alloc(0)));
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(encodeWsFrame(0xa, frame.payload));
          continue;
        }
        if (frame.opcode === 0x1) {
          try {
            const parsed = JSON.parse(frame.payload.toString('utf8'));
            if (parsed && typeof parsed === 'object') {
              void handleMessage(parsed);
            }
          } catch {
            sendJson({ type: 'error', message: 'Invalid JSON frame.' });
          }
        }
      }
    });

    const cleanup = () => {
      unsubBroker();
      presence.leaveAll(clientId);
      for (const sub of subs.values()) {
        if (sub.timer) clearTimeout(sub.timer);
      }
      subs.clear();
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  };
}
