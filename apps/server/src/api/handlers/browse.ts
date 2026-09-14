/**
 * File browser endpoint (Faza 10+): lists directories/files for the file picker.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { readdirSync, statSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

interface DirEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
}

/** GET /api/v1/browse?path=/mnt/dane — list directory contents. */
export async function browseHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const query = request.query as Record<string, string>;
  const dirPath = query.path || '/';

  try {
    const realPath = realpathSync(dirPath);

    // Ensure it's a directory
    const stats = statSync(realPath);
    if (!stats.isDirectory()) {
      reply.code(400).send({ error: { code: 'NOT_A_DIRECTORY', message: `Not a directory: ${realPath}` } });
      return;
    }

    const entries = readdirSync(realPath, { withFileTypes: true });
    const result: DirEntry[] = entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => {
        const fullPath = resolve(realPath, e.name);
        return {
          name: e.name,
          path: fullPath,
          type: e.isDirectory() ? 'dir' as const : 'file' as const,
          size: e.isFile() ? statSync(fullPath).size : undefined,
        };
      })
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.type === 'dir' && b.type === 'file') return -1;
        if (a.type === 'file' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });

    // Get parent directory for "up" navigation
    const parent = realPath !== '/' ? realPath.slice(0, realPath.lastIndexOf('/')) : '/';

    reply.send({
      path: realPath,
      parent: realPath !== '/' ? parent : null,
      entries: result,
    });
  } catch (err) {
    reply.code(400).send({
      error: {
        code: 'BROWSE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to browse directory',
      },
    });
  }
}
