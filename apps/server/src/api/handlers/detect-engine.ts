/**
 * Auto-detect engine binary (Settings): searches for llama-server in
 * known locations (build dirs, /usr/local/bin, PATH).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

/** Known locations to search for llama-server. */
const KNOWN_LOCATIONS: string[] = [
  // Build directories
  "~/llama.cpp/build/bin/llama-server",
  "~/llama.cpp/build/bin/llama-cli",
  "~/build/llama.cpp/build/bin/llama-server",
  "~/src/llama.cpp/build/bin/llama-server",
  "~/code/llama.cpp/build/bin/llama-server",
  "~/dev/llama.cpp/build/bin/llama-server",
  "~/projects/llama.cpp/build/bin/llama-server",
  "~/work/llama.cpp/build/bin/llama-server",
  "~/code/llama.cpp/build/llama-server",
  // System locations
  "/usr/local/bin/llama-server",
  "/usr/bin/llama-server",
  // Conda
  "~/miniconda3/bin/llama-server",
  "~/anaconda3/bin/llama-server",
];

interface DetectResult {
  found: boolean;
  binary: string | null;
  checked: string[];
}

/** Expands `~` to the user's home directory. */
function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    const home = process.env.HOME ?? "/home/bat";
    return `${home}/${path.slice(2)}`;
  }
  return path;
}

/** GET /api/v1/engines/detect — auto-detect the engine binary. */
export async function detectEngineHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const checked: string[] = [];
  let found: string | null = null;

  // Check known locations
  for (const loc of KNOWN_LOCATIONS) {
    const expanded = expandHome(loc);
    checked.push(expanded);
    if (existsSync(expanded)) {
      // Verify it's executable
      try {
        execSync(`test -x ${expanded}`, { timeout: 1000 });
        found = expanded;
        break;
      } catch {
        // not executable
      }
    }
  }

  // If not found in known locations, try `which`
  if (!found) {
    try {
      const which = execSync("which llama-server", {
        timeout: 2000,
        stdio: "pipe",
      })
        .toString()
        .trim();
      if (which && existsSync(which)) {
        found = which;
      }
    } catch {
      // not in PATH
    }
  }

  reply.send({
    found: found !== null,
    binary: found,
    checked,
  } satisfies DetectResult);
}
