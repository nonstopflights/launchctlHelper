import { constants } from "node:fs";
import { access, glob, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseBuffer } from "bplist-parser";
import plist from "plist";
import { z } from "zod";
import type {
  ActionResult,
  DoctorResult,
  LaunchctlPrintResult,
  PlistDocument,
  RuntimeState,
  ServiceDetail,
  ServiceFamily,
  ServiceSummary,
  SourceKind,
} from "@/lib/types";

interface ServiceRecord {
  label: string;
  path: string;
  plistDomain: ServiceFamily;
  suggestedDomain: string;
  sourceKind: SourceKind;
  program: string;
  programArguments: string[];
  runAtLoad: boolean | null;
  keepAlive: string;
  disabledHint: boolean | null;
  isApple: boolean;
  isUserInstalled: boolean;
  isWritable: boolean;
}

interface RuntimeStatus {
  pid: number | null;
  lastExitStatus: number | null;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface ParsedPlist {
  format: "xml" | "binary" | "unknown";
  xml: string | null;
  data: unknown;
}

const scanTargets: Record<ServiceFamily, string[]> = {
  system: ["/System/Library/LaunchDaemons", "/Library/LaunchDaemons"],
  "global-agent": ["/System/Library/LaunchAgents", "/Library/LaunchAgents"],
  "user-agent": [path.join(os.homedir(), "Library/LaunchAgents")],
  manual: [],
};

const actionPayloadSchema = z.object({
  path: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
});

const plistSaveSchema = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
});

export function encodeServiceId(servicePath: string): string {
  return Buffer.from(servicePath, "utf8").toString("base64url");
}

export function decodeServiceId(id: string): string {
  return Buffer.from(id, "base64url").toString("utf8");
}

export function currentUid(): number {
  return typeof process.getuid === "function" ? process.getuid() : Number(process.env.UID ?? 0);
}

export function guiDomain(): string {
  return `gui/${currentUid()}`;
}

export function userDomain(): string {
  return `user/${currentUid()}`;
}

export function domainSearchOrder(): string[] {
  return [guiDomain(), userDomain(), "system"];
}

export function inferDomainFromPath(servicePath: string): string {
  const resolvedPath = path.resolve(servicePath.replace(/^~(?=$|\/)/, os.homedir()));
  const home = path.resolve(os.homedir());

  if (resolvedPath.startsWith(home)) {
    return guiDomain();
  }
  if (resolvedPath.includes("/LaunchDaemons/")) {
    return "system";
  }
  if (resolvedPath.includes("/LaunchAgents/")) {
    return guiDomain();
  }
  return guiDomain();
}

function classifySource(servicePath: string): SourceKind {
  if (servicePath.startsWith("/System/Library/")) {
    return "apple";
  }
  if (servicePath.startsWith("/Library/")) {
    return "system";
  }
  return "user";
}

function isApplePath(servicePath: string): boolean {
  return servicePath.startsWith("/System/Library/");
}

async function fileIsWritable(servicePath: string): Promise<boolean> {
  try {
    await access(servicePath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(args: string[]): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        code: code ?? 1,
      });
    });
  });
}

function prettifyKeepAlive(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as object).sort().join(", ") || "dict";
  }
  return String(value);
}

async function parsePlistBuffer(buffer: Buffer): Promise<ParsedPlist> {
  const utf8 = buffer.toString("utf8");

  // Suppress xmldom console errors during parsing
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};

  try {
    try {
      const data = plist.parse(utf8);
      return {
        format: "xml",
        xml: plist.build(data),
        data,
      };
    } catch {
      const parsed = parseBuffer(buffer);
      const data = parsed.length === 1 ? parsed[0] : parsed;
      return {
        format: "binary",
        xml: plist.build(data),
        data,
      };
    }
  } catch {
    return {
      format: "unknown",
      xml: null,
      data: null,
    };
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

async function loadPlistDocument(servicePath: string): Promise<ParsedPlist> {
  try {
    const buffer = await readFile(servicePath);
    return await parsePlistBuffer(buffer);
  } catch {
    return {
      format: "unknown",
      xml: null,
      data: null,
    };
  }
}

async function parseServiceRecord(servicePath: string, plistDomain: ServiceFamily): Promise<ServiceRecord | null> {
  const document = await loadPlistDocument(servicePath);
  if (!document.data || typeof document.data !== "object" || Array.isArray(document.data)) {
    return null;
  }

  const data = document.data as Record<string, unknown>;
  const label = data.Label;
  if (typeof label !== "string" || !label.trim()) {
    return null;
  }

  const programArguments = Array.isArray(data.ProgramArguments)
    ? data.ProgramArguments.map((entry: unknown) => String(entry))
    : [];
  const isApple = isApplePath(servicePath);
  const sourceKind = classifySource(servicePath);
  const isWritable = isApple ? false : await fileIsWritable(servicePath);

  return {
    label,
    path: servicePath,
    plistDomain,
    suggestedDomain: inferDomainFromPath(servicePath),
    sourceKind,
    program: typeof data.Program === "string" ? data.Program : "",
    programArguments,
    runAtLoad: typeof data.RunAtLoad === "boolean" ? data.RunAtLoad : null,
    keepAlive: prettifyKeepAlive(data.KeepAlive),
    disabledHint: typeof data.Disabled === "boolean" ? data.Disabled : null,
    isApple,
    isUserInstalled: !isApple && (servicePath.startsWith("/Library/") || servicePath.startsWith(os.homedir())),
    isWritable,
  };
}

async function scanServices(): Promise<ServiceRecord[]> {
  const records: ServiceRecord[] = [];

  for (const [plistDomain, directories] of Object.entries(scanTargets) as Array<[ServiceFamily, string[]]>) {
    for (const directory of directories) {
      try {
        const matches = await glob(path.join(directory, "*.plist"));
        for await (const match of matches) {
          const record = await parseServiceRecord(match, plistDomain);
          if (record) {
            records.push(record);
          }
        }
      } catch {
        continue;
      }
    }
  }

  return records;
}

function scanByLabel(records: ServiceRecord[]): Map<string, ServiceRecord[]> {
  const index = new Map<string, ServiceRecord[]>();

  for (const record of records) {
    const bucket = index.get(record.label) ?? [];
    bucket.push(record);
    index.set(record.label, bucket);
  }

  return index;
}

async function parseLaunchctlList(): Promise<Map<string, RuntimeStatus>> {
  const result = await runCommand(["launchctl", "list"]);
  const statuses = new Map<string, RuntimeStatus>();

  if (result.code !== 0) {
    return statuses;
  }

  for (const line of result.stdout.split("\n")) {
    if (!line.trim() || line.startsWith("PID")) {
      continue;
    }

    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }

    const pidText = parts[0]?.trim() ?? "";
    const exitText = parts[1]?.trim() ?? "";
    const label = parts[2]?.trim() ?? "";
    if (!label) {
      continue;
    }

    const pid = pidText === "-" ? null : Number(pidText);
    const lastExitStatus = exitText === "-" ? null : Number(exitText);

    statuses.set(label, {
      pid: Number.isNaN(pid) ? null : pid,
      lastExitStatus: Number.isNaN(lastExitStatus) ? null : lastExitStatus,
    });
  }

  return statuses;
}

async function parseDisabled(domain: string): Promise<Map<string, boolean>> {
  const result = await runCommand(["launchctl", "print-disabled", domain]);
  const disabled = new Map<string, boolean>();

  if (result.code !== 0) {
    return disabled;
  }

  for (const rawLine of result.stdout.split("\n")) {
    const line = rawLine.trim().replace(/,$/, "");
    if (!line.startsWith("\"") || !line.includes("=>")) {
      continue;
    }

    const [labelPart, statePart] = line.split("=>", 2);
    const label = labelPart?.trim().replace(/^"|"$/g, "") ?? "";
    const state = statePart?.trim() ?? "";

    if (state === "disabled") {
      disabled.set(label, true);
    } else if (state === "enabled") {
      disabled.set(label, false);
    }
  }

  return disabled;
}

async function collectDisabledMaps(): Promise<Map<string, Map<string, boolean>>> {
  const domains = [guiDomain(), userDomain(), "system"];
  const entries = await Promise.all(domains.map(async (domain) => [domain, await parseDisabled(domain)] as const));
  return new Map(entries);
}

function determineDisabled(
  record: ServiceRecord,
  disabledMaps: Map<string, Map<string, boolean>>,
): boolean | null {
  const domainMap = disabledMaps.get(record.suggestedDomain);
  if (domainMap?.has(record.label)) {
    return domainMap.get(record.label) ?? null;
  }
  return record.disabledHint;
}

function getRuntimeState(record: ServiceRecord, runtime: Map<string, RuntimeStatus>): {
  state: RuntimeState;
  pid: number | null;
  lastExitStatus: number | null;
} {
  const status = runtime.get(record.label);

  if (status?.pid !== null && status?.pid !== undefined) {
    return { state: "running", pid: status.pid, lastExitStatus: status.lastExitStatus };
  }
  if (status) {
    return { state: "loaded", pid: null, lastExitStatus: status.lastExitStatus };
  }
  return { state: "unloaded", pid: null, lastExitStatus: null };
}

function toServiceSummary(
  record: ServiceRecord,
  runtime: Map<string, RuntimeStatus>,
  disabledMaps: Map<string, Map<string, boolean>>,
): ServiceSummary {
  const runtimeState = getRuntimeState(record, runtime);

  return {
    id: encodeServiceId(record.path),
    label: record.label,
    path: record.path,
    plistDomain: record.plistDomain,
    suggestedDomain: record.suggestedDomain,
    sourceKind: record.sourceKind,
    program: record.program,
    programArguments: record.programArguments,
    runAtLoad: record.runAtLoad,
    keepAlive: record.keepAlive,
    disabledHint: record.disabledHint,
    state: runtimeState.state,
    pid: runtimeState.pid,
    lastExitStatus: runtimeState.lastExitStatus,
    disabled: determineDisabled(record, disabledMaps),
    isApple: record.isApple,
    isUserInstalled: record.isUserInstalled,
    isWritable: record.isWritable,
  };
}

function sortServices(services: ServiceSummary[]): ServiceSummary[] {
  const weight: Record<RuntimeState, number> = {
    running: 0,
    loaded: 1,
    unloaded: 2,
  };

  return services.sort((left, right) => {
    return (
      weight[left.state] - weight[right.state] ||
      left.suggestedDomain.localeCompare(right.suggestedDomain) ||
      left.label.localeCompare(right.label)
    );
  });
}

export async function getServices(): Promise<ServiceSummary[]> {
  const [records, runtime, disabledMaps] = await Promise.all([
    scanServices(),
    parseLaunchctlList(),
    collectDisabledMaps(),
  ]);

  return sortServices(records.map((record) => toServiceSummary(record, runtime, disabledMaps)));
}

export async function getServiceDetail(id: string): Promise<ServiceDetail | null> {
  const servicePath = decodeServiceId(id);
  const services = await getServices();
  const service = services.find((entry) => entry.path === servicePath);
  if (!service) {
    return null;
  }

  const [document, printResults] = await Promise.all([
    loadPlistDocument(service.path),
    launchctlPrint(service.label),
  ]);

  return {
    service,
    rawPlist: document.xml,
    plistFormat: document.format,
    printResults,
  };
}

export async function launchctlPrint(label: string, domain?: string): Promise<LaunchctlPrintResult[]> {
  const domains = domain ? [domain] : domainSearchOrder();
  const results = await Promise.all(
    domains.map(async (candidate) => {
      const result = await runCommand(["launchctl", "print", `${candidate}/${label}`]);
      return {
        domain: candidate,
        ok: result.code === 0,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      };
    }),
  );

  return results;
}

async function resolveActionTarget(input: z.infer<typeof actionPayloadSchema>): Promise<{
  label: string;
  path: string | null;
  domain: string;
}> {
  if (input.path) {
    const servicePath = path.resolve(input.path.replace(/^~(?=$|\/)/, os.homedir()));
    const record = await parseServiceRecord(servicePath, "manual");
    const label = record?.label ?? path.basename(servicePath, path.extname(servicePath));

    return {
      label,
      path: servicePath,
      domain: input.domain ?? inferDomainFromPath(servicePath),
    };
  }

  if (!input.label) {
    throw new Error("A path or label is required.");
  }

  const records = await scanServices();
  const matches = scanByLabel(records).get(input.label) ?? [];
  if (matches.length > 1 && !input.domain) {
    throw new Error("Multiple plist files share that label. Retry with an explicit domain or path.");
  }

  const matchedRecord = matches[0] ?? null;
  return {
    label: input.label,
    path: matchedRecord?.path ?? null,
    domain: input.domain ?? matchedRecord?.suggestedDomain ?? guiDomain(),
  };
}

async function runAction(command: string[], domain: string): Promise<ActionResult> {
  const result = await runCommand(command);
  return {
    ok: result.code === 0,
    command,
    domain,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    code: result.code,
  };
}

export async function loadService(payload: unknown): Promise<ActionResult> {
  const input = actionPayloadSchema.parse(payload);
  if (!input.path) {
    throw new Error("Loading requires a plist path.");
  }

  const target = await resolveActionTarget(input);
  return await runAction(["launchctl", "bootstrap", target.domain, target.path!], target.domain);
}

export async function unloadService(payload: unknown): Promise<ActionResult> {
  const input = actionPayloadSchema.parse(payload);
  const target = await resolveActionTarget(input);

  const command = target.path
    ? ["launchctl", "bootout", target.domain, target.path]
    : ["launchctl", "bootout", `${target.domain}/${target.label}`];

  return await runAction(command, target.domain);
}

export async function setServiceEnabled(action: "enable" | "disable", payload: unknown): Promise<ActionResult> {
  const input = actionPayloadSchema.parse(payload);
  const target = await resolveActionTarget(input);
  return await runAction(["launchctl", action, `${target.domain}/${target.label}`], target.domain);
}

export async function getPlistDocument(servicePath: string): Promise<PlistDocument> {
  const resolvedPath = path.resolve(servicePath.replace(/^~(?=$|\/)/, os.homedir()));
  const document = await loadPlistDocument(resolvedPath);
  const isWritable = !isApplePath(resolvedPath) && (await fileIsWritable(resolvedPath));

  if (!document.xml) {
    throw new Error("Unable to parse the plist file.");
  }

  return {
    path: resolvedPath,
    content: document.xml,
    format: document.format,
    isWritable,
  };
}

export async function savePlistDocument(payload: unknown): Promise<{
  ok: boolean;
  path: string;
  backupPath: string;
}> {
  const input = plistSaveSchema.parse(payload);
  const resolvedPath = path.resolve(input.path.replace(/^~(?=$|\/)/, os.homedir()));

  if (isApplePath(resolvedPath)) {
    throw new Error("System plist files under /System/Library are read-only in this app.");
  }

  const parsed = plist.parse(input.content);
  const normalized = plist.build(parsed);
  await access(resolvedPath, constants.W_OK);

  const backupPath = `${resolvedPath}.${new Date().toISOString().replaceAll(":", "-")}.bak`;
  const original = await readFile(resolvedPath);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, original);
  await writeFile(resolvedPath, normalized, "utf8");

  return {
    ok: true,
    path: resolvedPath,
    backupPath,
  };
}

export async function getDoctorReport(): Promise<DoctorResult> {
  const [records, runtime, disabledMaps] = await Promise.all([
    scanServices(),
    parseLaunchctlList(),
    collectDisabledMaps(),
  ]);

  const labelIndex = scanByLabel(records);
  const duplicateLabels = Array.from(labelIndex.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([label, matches]) => ({
      label,
      paths: matches.map((match) => match.path),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const loadedWithoutPlist = Array.from(runtime.entries())
    .filter(([label]) => !labelIndex.has(label))
    .map(([label, status]) => ({
      label,
      pid: status.pid,
      lastExitStatus: status.lastExitStatus,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const disabledButLoaded = records
    .filter((record) => {
      const disabled = determineDisabled(record, disabledMaps);
      return disabled !== false && runtime.has(record.label);
    })
    .map((record) => toServiceSummary(record, runtime, disabledMaps));

  return {
    duplicateLabels,
    loadedWithoutPlist,
    disabledButLoaded,
  };
}
