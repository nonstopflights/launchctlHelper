export type RuntimeState = "running" | "loaded" | "unloaded";

export type ServiceFamily = "system" | "global-agent" | "user-agent" | "manual";

export type SourceKind = "apple" | "system" | "user";

export interface ServiceSummary {
  id: string;
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
  state: RuntimeState;
  pid: number | null;
  lastExitStatus: number | null;
  disabled: boolean | null;
  isApple: boolean;
  isUserInstalled: boolean;
  isWritable: boolean;
}

export interface LaunchctlPrintResult {
  domain: string;
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface ServiceDetail {
  service: ServiceSummary;
  printResults: LaunchctlPrintResult[];
  rawPlist: string | null;
  plistFormat: "xml" | "binary" | "unknown";
}

export interface ActionResult {
  ok: boolean;
  command: string[];
  domain: string;
  stdout: string;
  stderr: string;
  code: number;
}

export interface DoctorResult {
  duplicateLabels: Array<{
    label: string;
    paths: string[];
  }>;
  loadedWithoutPlist: Array<{
    label: string;
    pid: number | null;
    lastExitStatus: number | null;
  }>;
  disabledButLoaded: ServiceSummary[];
}

export interface PlistDocument {
  path: string;
  content: string;
  format: "xml" | "binary" | "unknown";
  isWritable: boolean;
}
