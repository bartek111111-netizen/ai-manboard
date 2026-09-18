import { fileURLToPath } from "node:url";

/**
 * Absolute path to the built web app (apps/web/dist), resolved from this
 * file so it does not depend on the current working directory.
 */
export const WEB_DIST_DIR = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);
