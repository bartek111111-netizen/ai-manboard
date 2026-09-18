/**
 * GPU monitoring (Faza 10.2): reads GPU memory from sysfs (Linux AMD GPUs)
 * or `nvidia-smi` (NVIDIA). Caches detection to avoid repeated failures.
 */
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolveHome } from "./core/config/paths.js";

export interface GpuInfo {
  /** GPU name. */
  name?: string;
  /** Memory used in MB (null when not available). */
  memoryUsedMB?: number | null;
  /** Total memory in MB (null when not available). */
  memoryTotalMB?: number | null;
  /** Utilization percentage (null when not available). */
  utilization?: number | null;
}

/** Cached result of GPU source detection (avoid repeated nvidia-smi failures). */
let gpuSourceCache: "sysfs" | "nvidia" | "none" | null = null;

/** Detects which GPU source is available (cached after first detection). */
export function detectGpuSource(): "sysfs" | "nvidia" | "none" {
  if (gpuSourceCache !== null) return gpuSourceCache;

  // Check if nvidia-smi exists (only once)
  let hasNvidia = false;
  try {
    execSync("nvidia-smi -L", { timeout: 2000, stdio: "ignore" });
    hasNvidia = true;
  } catch {
    // nvidia-smi not available
  }

  // Check if AMD sysfs exists (only once)
  let hasSysfs = false;
  try {
    const cards = readdirSync("/sys/class/drm").filter((n) =>
      /^card\d+$/.test(n),
    );
    for (const card of cards) {
      try {
        readFileSync(
          `/sys/class/drm/${card}/device/mem_info_vram_total`,
          "utf8",
        );
        hasSysfs = true;
        break;
      } catch {
        // this card doesn't have the file
      }
    }
  } catch {
    // no /sys/class/drm
  }

  gpuSourceCache = hasSysfs ? "sysfs" : hasNvidia ? "nvidia" : "none";
  return gpuSourceCache;
}

/**
 * Reads AMD GPU info from sysfs. Scans all card* devices and picks the one
 * with `mem_info_vram_total` (the actual GPU, not the integrated/placeholder).
 */
export function readGpuFromSysfs(): GpuInfo | null {
  try {
    const drmDir = "/sys/class/drm";
    const cards = readdirSync(drmDir).filter((n) => /^card\d+$/.test(n));

    for (const card of cards) {
      const devDir = `${drmDir}/${card}/device`;
      try {
        const totalRaw = readFileSync(
          `${devDir}/mem_info_vram_total`,
          "utf8",
        ).trim();
        const totalBytes = Number(totalRaw);
        if (!Number.isFinite(totalBytes) || totalBytes === 0) continue;

        const totalMB = Math.round(totalBytes / 1024 / 1024);

        let usedMB: number | null = null;
        try {
          const usedRaw = readFileSync(
            `${devDir}/mem_info_vram_used`,
            "utf8",
          ).trim();
          const usedBytes = Number(usedRaw);
          if (Number.isFinite(usedBytes))
            usedMB = Math.round(usedBytes / 1024 / 1024);
        } catch {
          // used not available
        }

        let utilization: number | null = null;
        try {
          const busy = Number(
            readFileSync(`${devDir}/gpu_busy_percent`, "utf8").trim(),
          );
          if (Number.isFinite(busy)) utilization = busy;
        } catch {
          // utilization not available
        }

        // Get GPU name from lspci (cached)
        let name = "AMD GPU";
        try {
          const uevent = readFileSync(`${devDir}/uevent`, "utf8");
          const pciSlot =
            uevent.match(/PCI_SLOT_NAME=([0-9a-f:.]+)/)?.[1] ?? "";
          if (pciSlot) {
            try {
              const output = execSync(`lspci -s ${pciSlot}`, { timeout: 1000 })
                .toString()
                .trim();
              const match = output.match(/: (.+?)(?: \(rev|$)/);
              name = match?.[1]?.trim() ?? `AMD GPU (${pciSlot})`;
            } catch {
              // lspci failed
            }
          }
        } catch {
          // no uevent
        }

        return {
          name,
          memoryTotalMB: totalMB,
          memoryUsedMB: usedMB,
          utilization,
        };
      } catch {
        // this card doesn't have the files — try the next
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reads GPU info using `nvidia-smi` (NVIDIA GPUs). Returns null when
 * `nvidia-smi` is not available.
 */
export function readGpuFromNvidiaSmi(): GpuInfo | null {
  try {
    const output = execSync(
      "nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits",
      { timeout: 3000 },
    ).toString();
    const lines = output.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) return null;

    const first = lines[0].split(",").map((s) => s.trim());
    const name = first[0] || "NVIDIA GPU";
    const usedMB = first[1] ? Number(first[1]) : null;
    const totalMB = first[2] ? Number(first[2]) : null;
    const utilPct = first[3] ? Number(first[3]) : null;

    return {
      name,
      memoryUsedMB: Number.isFinite(usedMB ?? 0) ? usedMB : null,
      memoryTotalMB: Number.isFinite(totalMB ?? 0) ? totalMB : null,
      utilization: Number.isFinite(utilPct ?? 0) ? utilPct : null,
    };
  } catch {
    return null;
  }
}

/**
 * Reads the user-configured GPU label from `config/global.json` (`gpu.label` +
 * `gpu.useLabel`). Returns null when the label is not enabled, so the detected
 * name is used. A short cache avoids re-reading the file on every poll.
 */
let gpuLabelCache: { label: string | null; at: number } | null = null;
const GPU_LABEL_CACHE_MS = 5000;

function getGpuLabel(): string | null {
  const now = Date.now();
  if (gpuLabelCache && now - gpuLabelCache.at < GPU_LABEL_CACHE_MS) {
    return gpuLabelCache.label;
  }
  let label: string | null = null;
  try {
    const { globalFile } = resolveHome();
    const cfg = JSON.parse(readFileSync(globalFile, "utf8"));
    if (
      cfg?.gpu?.useLabel === true &&
      typeof cfg?.gpu?.label === "string" &&
      cfg.gpu.label.trim() !== ""
    ) {
      label = cfg.gpu.label.trim();
    }
  } catch {
    // config file missing/unreadable — use the detected name
  }
  gpuLabelCache = { label, at: now };
  return label;
}

/**
 * Reads GPU info from the detected source. Uses cached detection to avoid
 * repeated `nvidia-smi` failures on systems without NVIDIA GPUs. When the user
 * enabled a custom GPU label (`global.gpu.useLabel`), the displayed `name` is
 * replaced by it, so all GPU name displays show the user's name.
 */
export function readGpuInfo(): GpuInfo | null {
  const source = detectGpuSource();
  let info: GpuInfo | null = null;
  switch (source) {
    case "sysfs":
      info = readGpuFromSysfs();
      break;
    case "nvidia":
      info = readGpuFromNvidiaSmi();
      break;
    case "none":
      info = null;
      break;
  }
  if (info) {
    const label = getGpuLabel();
    if (label) info = { ...info, name: label };
  }
  return info;
}
