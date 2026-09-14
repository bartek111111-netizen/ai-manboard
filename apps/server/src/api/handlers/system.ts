/**
 * System metrics endpoint (Faza 10+): GPU/CPU/RAM usage.
 * Uses `systeminformation` for CPU/RAM and `gpu.ts` for GPU.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import si from 'systeminformation';
import { readGpuInfo } from '../../gpu.js';

/** GET /api/v1/system/metrics */
export async function systemMetricsHandler(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const [cpu, mem, temp] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.cpuTemperature().catch(() => ({ main: null })),
  ]);

  // GPU (synchronous, best-effort)
  const gpu = readGpuInfo() ?? null;

  reply.send({
    gpu,
    cpu: {
      usagePct: cpu.currentLoad,
      loadAvg: null,
      temperatureC: temp.main ?? null,
    },
    ram: {
      usedMB: Math.round(mem.used / 1024),
      totalMB: Math.round(mem.total / 1024),
    },
    os: process.platform,
  });
}
