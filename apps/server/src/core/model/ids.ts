/**
 * Model ids (PLAN §8.1): `slug(name) + '-' + hash8(sha1(path))` — stable,
 * unique and human-readable. The file is the model (S-5); the id derives
 * from the path so a given file always maps to the same id.
 */
import { createHash } from "node:crypto";
import { basename } from "node:path";

/**
 * Slugs a name: lowercase, last extension stripped, runs of non-alphanumerics
 * collapsed to a single `-`. Falls back to `model` when nothing remains
 * (e.g. a file literally named `.gguf`).
 */
export function slugify(name: string): string {
  const withoutExt = name.replace(/\.[a-z0-9]+$/i, "");
  const slug = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "model";
}

/** First 8 hex chars of the sha1 digest of a string. */
export function hash8(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 8);
}

/**
 * Builds the stable model id for a model file path (PLAN §8.1):
 * `slug(filename)` + `-` + `hash8(sha1(absolute path))`.
 */
export function modelIdFor(filePath: string): string {
  return `${slugify(basename(filePath))}-${hash8(filePath)}`;
}
