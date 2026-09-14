/**
 * GPU monitoring (Faza 10.2, opcjonalnie): reads GPU memory usage from
 * sysfs (Linux) for AMD GPUs. NVIDIA GPUs can use `nvidia-smi` (not included
 * here — optional).
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

export interface GpuInfo {
  /** GPU name (from sysfs or `nvidia-smi`). */
  name?: string;
  /** Memory used in MB (null when not available). */
  memoryUsedMB?: number | null;
  /** Total memory in MB (null when not available). */
  memoryTotalMB?: number | null;
  /** Utilization percentage (null when not available). */
  utilization?: number | null;
}

/**
 * Reads GPU info from sysfs (Linux AMD GPUs). Returns null when the GPU
 * is not detected (no sysfs entries).
 */
export function readGpuFromSysfs(): GpuInfo | null {
  try {
    // AMD GPUs expose memory via /sys/class/drm/card*/device/mem_*
    // or /proc/driver/amdgpu/gpu0_vram_total
    const total = readAmdVramTotal();
    if (total === null) return null;

    // Try to read used memory from /proc or sysfs
    const used = readAmdVramUsed();
    return {
      name: 'AMD GPU (sysfs)',
      memoryTotalMB: total,
      memoryUsedMB: used,
      utilization: total > 0 && used !== null ? Math.round((used / total) * 100) : null,
    };
  } catch {
    return null;
  }
}

/** Reads AMD VRAM total from sysfs (MB). Returns null when not found. */
function readAmdVramTotal(): number | null {
  try {
    const content = readFileSync('/sys/class/drm/card0/device/mem_vram_total', 'utf8');
    const kb = Number(content.trim().replace(/[^0-9]/g, ''));
    if (!Number.isFinite(kb)) return null;
    return Math.round(kb / 1024);
  } catch {
    return null;
  }
}

/** Reads AMD VRAM used from /proc (MB). Returns null when not available. */
function readAmdVramUsed(): number | null {
  try {
    const output = execSync('cat /proc/driver/amdgpu/gpu0_vram_used', { timeout: 1000 }).toString().trim();
    const kb = Number(output.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(kb)) return null;
    return Math.round(kb / 1024);
  } catch {
    return null;
  }
}

/**
 * Reads GPU info using `nvidia-smi` (NVIDIA GPUs). Returns null when
 * `nvidia-smi` is not available or the command fails.
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
      memoryUsedMB: Number.isFinite(usedMB ?? 0) ? usedMB! : null,
      memoryTotalMB: Number.isFinite(totalMB ?? 0) ? totalMB! : null,
      utilization: Number.isFinite(utilPct ?? 0) ? utilPct! : null,
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
