import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCliArgs, scanEngineProcesses } from "./external.js";

describe("parseCliArgs", () => {
  it("parses --key value and --key=value forms, skipping argv[0]", () => {
    const argv = [
      "/home/bat/llama.cpp/build/bin/llama-server",
      "--model",
      "/mnt/dane/Odysseus/models/Qwen3.8-27B-Ridge-3.7bpw.gguf",
      "--port",
      "8080",
      "--host",
      "127.0.0.1",
      "--n-gpu-layers",
      "32",
      "--flash-attn=on",
      "-t",
      "16",
    ];
    const args = parseCliArgs(argv);
    expect(args["model"]).toBe(
      "/mnt/dane/Odysseus/models/Qwen3.8-27B-Ridge-3.7bpw.gguf",
    );
    expect(args["port"]).toBe("8080");
    expect(args["host"]).toBe("127.0.0.1");
    expect(args["n-gpu-layers"]).toBe("32");
    expect(args["flash-attn"]).toBe("on");
    // Short flags (`-t 16`) are not `--` flags; only the first token is captured.
    expect(args["t"]).toBeUndefined();
  });

  it("does not consume a following flag as a value", () => {
    const args = parseCliArgs(["llama-server", "--no-warmup", "--verbose"]);
    expect(args["no-warmup"]).toBeUndefined(); // no value (next is a flag)
    expect(args["verbose"]).toBeUndefined();
  });
});

describe("scanEngineProcesses", () => {
  it("finds engine processes by argv[0] basename and reads their args", () => {
    const root = mkdtempSync(join(tmpdir(), "fake-proc-"));
    const writeCmdline = (pid: string, content: string): void => {
      mkdirSync(join(root, pid));
      writeFileSync(join(root, pid, "cmdline"), content, { mode: 0o555 });
    };
    try {
      writeCmdline(
        "100",
        "/home/bat/llama.cpp/build/bin/llama-server\x00--model\x00/m/x.gguf\x00--port\x008080\x00",
      );
      writeCmdline("200", "/usr/bin/python3\x00script.py\x00");
      writeCmdline("300", "/opt/llama-server\x00--model\x00/m/y.gguf\x00");
      const found = scanEngineProcesses(["llama-server"], root);
      expect(found.map((p) => p.pid).sort((a, b) => a - b)).toEqual([100, 300]);
      const p100 = found.find((p) => p.pid === 100);
      expect(p100?.modelPath).toBe("/m/x.gguf");
      expect(p100?.port).toBe(8080);
      expect(p100?.args["model"]).toBe("/m/x.gguf");
      // The python process is not an engine binary → not found.
      expect(found.find((p) => p.pid === 200)).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns an empty list when the proc root is unreadable", () => {
    expect(scanEngineProcesses(["llama-server"], "/nonexistent/proc")).toEqual(
      [],
    );
  });
});
