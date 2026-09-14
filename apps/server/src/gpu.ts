/**
 * GPU monitoring (Faza 10.2): reads GPU memory from sysfs (Linux AMD GPUs)
 * or `nvidia-smi` (NVIDIA).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

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

/**
 * Reads AMD GPU info from sysfs. Scans all card* devices and picks the one
 * with `mem_info_vram_total` (the actual GPU, not the integrated/placeholder).
 */
export function readGpuFromSysfs(): GpuInfo | null {
  try {
    const drmDir = '/sys/class/drm';
    const cards = readdirSync(drmDir).filter((n) => /^card\d+$/.test(n));

    for (const card of cards) {
      const devDir = `${drmDir}/${card}/device`;
      try {
        const totalRaw = readFileSync(`${devDir}/mem_info_vram_total`, 'utf8').trim();
        const totalBytes = Number(totalRaw);
        if (!Number.isFinite(totalBytes) || totalBytes === 0) continue;

        const totalMB = Math.round(totalBytes / 1024 / 1024);

        let usedMB: number | null = null;
        try {
          const usedRaw = readFileSync(`${devDir}/mem_info_vram_used`, 'utf8').trim();
          const usedBytes = Number(usedRaw);
          if (Number.isFinite(usedBytes)) usedMB = Math.round(usedBytes / 1024 / 1024);
        } catch {
          // used not available
        }

        let utilization: number | null = null;
        try {
          const busy = Number(readFileSync(`${devDir}/gpu_busy_percent`, 'utf8').trim());
          if (Number.isFinite(busy)) utilization = busy;
        } catch {
          // utilization not available
        }

        // Get GPU name from uevent (PCI_ID → human-readable)
        let name = 'AMD GPU';
        try {
          const uevent = readFileSync(`${devDir}/uevent`, 'utf8');
          const pciId = uevent.match(/PCI_ID=([0-9a-f:.]+)/)?.[1] ?? '';
          if (pciId) name = `AMD GPU (${pciId})`;
        } catch {
          // no uevent
        }

        return { name, memoryTotalMB: totalMB, memoryUsedMB: usedMB, utilization };
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
      'nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits',
      { timeout: 3000 },
    ).toString();
    const lines = output.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return null;

    const first = lines[0].split(',').map((s) => s.trim());
    const name = first[0] || 'NVIDIA GPU';
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
 * Reads GPU info from all available sources. Tries sysfs (AMD) first,
 * then `nvidia-smi` (NVIDIA). Returns null when no GPU is detected.
 */
export function readGpuInfo(): GpuInfo | null {
  return readGpuFromSysfs() ?? readGpuFromNvidiaSmi();
}
