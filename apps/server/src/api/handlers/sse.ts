/**
 * SSE endpoints (Faza 6.2, PLAN §14.1):
 * - `GET /api/v1/stream/:instanceId/logs` — live logs (replay ring tail + live lines).
 * - `GET /api/v1/stream/events`           — global state-change events.
 *
 * Both are `text/event-stream`; the client auto-reconnects (EventSource). The
 * hub is the single source of truth (the process manager publishes). Each
 * handler hijacks the Fastify reply and writes events directly to the socket,
 * unsubscribing on client disconnect.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SseHub, StateEvent } from '../../core/sse/hub.js';
import type { LogLine } from '../../core/logs/ringbuffer.js';
import type { ProcessManager } from '../../core/process/manager.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

/** One SSE frame for a named event with a JSON payload. */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function makeSseHandlers(hub: SseHub, manager: ProcessManager) {
  return {
    /** GET /api/v1/stream/:instanceId/logs — live logs. */
    logs: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const instanceId = String((request.params as Record<string, string>).instanceId);
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, SSE_HEADERS);
      // Replay the recent ring so a fresh client doesn't miss the tail.
      for (const line of manager.getLogs(instanceId)) {
        raw.write(frame('log', line));
      }
      const unsub = hub.subscribeLog(instanceId, (line: LogLine) => {
        raw.write(frame('log', line));
      });
      request.raw.on('close', () => unsub());
    },

    /** GET /api/v1/stream/events — global state-change events. */
    events: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, SSE_HEADERS);
      const unsub = hub.subscribeEvents((event: StateEvent) => {
        raw.write(frame('state', event));
      });
      request.raw.on('close', () => unsub());
    },
  };
}
