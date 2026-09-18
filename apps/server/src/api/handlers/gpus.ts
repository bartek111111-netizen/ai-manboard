/**
 * GPU list endpoint (Faza 10+): lists all detected GPUs with names + PCIe slots.
 * Uses cached GPU source detection to avoid repeated nvidia-smi failures.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { detectGpuSource } from "../../gpu.js";

interface GpuEntry {
  id: string;
  name: string;
  pciSlot: string;
  memoryTotalMB: number | null;
  memoryUsedMB: number | null;
  utilization: number | null;
  driver: string;
}

/** Gets the human-readable GPU name from lspci. */
function getLspciName(pciSlot: string): string | null {
  try {
    const output = execSync(`lspci -s ${pciSlot}`, { timeout: 1000 })
      .toString()
      .trim();
    // e.g. "03:00.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Navi 48 [Radeon RX 9070/9070 XT/9070 GRE] (rev c0)"
    const match = output.match(/: (.+?)(?: \(rev|$)/);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Reads all AMD GPUs from sysfs. */
function listAmdGpus(): GpuEntry[] {
  const gpus: GpuEntry[] = [];
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
          // not available
        }

        let utilization: number | null = null;
        try {
          const busy = Number(
            readFileSync(`${devDir}/gpu_busy_percent`, "utf8").trim(),
          );
          if (Number.isFinite(busy)) utilization = busy;
        } catch {
          // not available
        }

        const uevent = readFileSync(`${devDir}/uevent`, "utf8");
        const pciSlot =
          uevent.match(/PCI_SLOT_NAME=([0-9a-f:.]+)/)?.[1] ?? "unknown";
        const pciId = uevent.match(/PCI_ID=([0-9a-f:.]+)/)?.[1] ?? "unknown";

        // Try to get the real name from lspci
        const lspciName = getLspciName(pciSlot);
        const name = lspciName ?? `AMD GPU (${pciId})`;

        gpus.push({
          id: card,
          name,
          pciSlot,
          memoryTotalMB: totalMB,
          memoryUsedMB: usedMB,
          utilization,
          driver: "amdgpu",
        });
      } catch {
        // this card doesn't have the files
      }
    }
  } catch {
    // no /sys/class/drm
  }
  return gpus;
}

/** Reads NVIDIA GPUs from nvidia-smi (only when the source is 'nvidia'). */
function listNvidiaGpus(): GpuEntry[] {
  const gpus: GpuEntry[] = [];
  // Only call nvidia-smi when detection says it's available
  if (detectGpuSource() !== "nvidia") return gpus;
  try {
    const output = execSync(
      "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu,driver_version --format=csv,noheader,nounits",
      { timeout: 3000 },
    ).toString();
    const lines = output.split("\n").filter((l) => l.trim() !== "");
    for (const line of lines) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length < 5) continue;
      gpus.push({
        id: `nvidia_${parts[0]}`,
        name: parts[1],
        pciSlot: `GPU ${parts[0]}`,
        memoryTotalMB: Number(parts[3]) || null,
        memoryUsedMB: Number(parts[2]) || null,
        utilization: Number(parts[4]) || null,
        driver: parts[5] || "nvidia",
      });
    }
  } catch {
    // nvidia-smi not available
  }
  return gpus;
}

/** GET /api/v1/gpus — list all detected GPUs. */
export async function gpusHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const gpus = [...listAmdGpus(), ...listNvidiaGpus()];
  reply.send({ gpus });
}
