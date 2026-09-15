import { spawn } from "child_process";
import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { ReportPayload } from "./reportPayload";

export type ExactPair = {
  doc: Uint8Array;
  pdf: Uint8Array;
};

type CacheEntry = ExactPair & { key: string; at: number };

let inflight: Promise<ExactPair | null> | null = null;
let cache: CacheEntry | null = null;

function projectRoot(): string {
  return process.cwd();
}

function templatePath(): string {
  return path.join(projectRoot(), "templates", "Feedly News Letter 2026-02-26_sample.doc");
}

function scriptPath(): string {
  return path.join(projectRoot(), "scripts", "fill_feedly_report.py");
}

function runPython(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const candidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  const tryOne = (cmd: string, extra: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(cmd, [...extra, ...args], {
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });

  return (async () => {
    let lastErr: unknown;
    for (const cmd of candidates) {
      const extra = cmd === "py" ? ["-3"] : [];
      try {
        return await tryOne(cmd, extra);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Python is not available");
  })();
}

function payloadJson(payload: ReportPayload) {
  const section = (heading: string) => payload.sections.find((s) => s.heading === heading)?.items ?? [];
  return {
    dateStamp: payload.dateStamp,
    topItems: payload.topItems,
    hkItems: section("Intelligence from HKCERT"),
    govItems: section("Intelligence from GovCERT.HK"),
    cyberItems: section("Intelligence from Cybersechub"),
  };
}

function cacheKey(payload: ReportPayload): string {
  return createHash("sha1").update(JSON.stringify(payloadJson(payload))).digest("hex");
}

async function fillWithWord(payload: ReportPayload): Promise<ExactPair> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "feedly-web-"));
  const jsonPath = path.join(tmp, "payload.json");
  const outDoc = path.join(tmp, `${payload.basename}.doc`);
  await fs.writeFile(jsonPath, JSON.stringify(payloadJson(payload)), "utf8");
  try {
    const result = await Promise.race([
      runPython([scriptPath(), "--template", templatePath(), "--payload", jsonPath, "--out-doc", outDoc]),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Word export timed out")), 120_000);
      }),
    ]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `Word export failed (${result.code})`);
    }
    const pdfPath = outDoc.replace(/\.doc$/i, ".pdf");
    const [doc, pdf] = await Promise.all([fs.readFile(outDoc), fs.readFile(pdfPath)]);
    return { doc: new Uint8Array(doc), pdf: new Uint8Array(pdf) };
  } finally {
    await new Promise((r) => setTimeout(r, 250));
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function buildExactPair(payload: ReportPayload): Promise<ExactPair | null> {
  if (process.platform !== "win32") return null;
  try {
    await fs.access(templatePath());
    await fs.access(scriptPath());
  } catch {
    return null;
  }
  const key = cacheKey(payload);
  if (cache && cache.key === key && Date.now() - cache.at < 25_000) {
    return { doc: cache.doc, pdf: cache.pdf };
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const pair = await fillWithWord(payload);
      cache = { ...pair, key, at: Date.now() };
      return pair;
    } catch (err) {
      console.error("[report] Word template fill failed, using layout fallback", err);
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
