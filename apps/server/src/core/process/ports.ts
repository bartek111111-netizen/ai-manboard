/**
 * Port allocation (PLAN §11.4) — Faza 4.
 *
 * Auto-allocation: the first free port in `global.json → portRange`.
 * "Taken" = ports claimed by other registered instances (+ optional reachability
 * check). A collision on a pinned port is a loud `PORT_IN_USE` error carrying a
 * free-port suggestion — conflicts are never resolved silently (§11.4).
 */
import { AppError } from '@ai-dashboard/shared';

export interface PortRange {
  start: number;
  end: number;
}

/**
 * Returns the first free port in `[start, end]`.
 * @throws AppError('PORT_IN_USE') when the whole range is occupied.
 */
export function allocatePort(range: PortRange, taken: Iterable<number>): number {
  const takenSet = new Set(taken);
  for (let port = range.start; port <= range.end; port++) {
    if (!takenSet.has(port)) return port;
  }
  throw new AppError(
    'PORT_IN_USE',
    `no free port in range ${range.start}–${range.end}`,
    { range: { start: range.start, end: range.end } },
  );
}

/**
 * Asserts a pinned port is free; otherwise `PORT_IN_USE` with a suggestion.
 */
export function assertPortFree(port: number, range: PortRange, taken: Iterable<number>): void {
  if (new Set(taken).has(port)) {
    // Best-effort free-port suggestion; `null` when the range is fully occupied.
    let suggestion: number | null;
    try {
      suggestion = allocatePort(range, taken);
    } catch {
      suggestion = null; // range exhausted
    }
    throw new AppError(
      'PORT_IN_USE',
      `port ${port} is already in use by another instance`,
      { port, suggestion },
    );
  }
}

/**
 * Validates a port against the S-9 bound (1024–65535).
 */
export function assertValidPort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new AppError('VALIDATION_FAILED', `invalid port ${port} (must be 1024–65535)`, { port });
  }
}

/**
 * Checks if a port is actually in use on the system (by any process).
 * Uses a quick TCP connection test — if we can connect, the port is taken.
 */
export async function isPortInUse(port: number): Promise<boolean> {
  const { createServer } = await import('node:net');
  const { promisify } = await import('node:util');
  const listen = promisify((cb: (err: Error | null) => void) => {
    const server = createServer();
    server.once('error', (err) => cb(err));
    server.once('listening', () => {
      server.close(() => cb(null));
    });
    server.listen(port, '127.0.0.1');
  });
  try {
    await listen();
    return false; // port is free
  } catch {
    return true; // port is in use
  }
}
