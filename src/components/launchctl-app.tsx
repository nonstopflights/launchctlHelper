"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Cpu,
  Eye,
  FileCode2,
  FolderCog,
  Loader2,
  Power,
  RefreshCcw,
  Save,
  Search,
  Shield,
  Terminal,
  X,
} from "lucide-react";
import type { ActionResult, DoctorResult, ServiceDetail, ServiceSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Toast = {
  id: number;
  title: string;
  message: string;
  tone: "success" | "error";
};

type ActionName = "load" | "unload" | "enable" | "disable";
type StateFilter = "all" | "running" | "loaded" | "unloaded";
type SourceFilter = "all" | "custom" | "apple";
type FamilyFilter = "all" | "user-agent" | "global-agent" | "system";

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const named = "type" in error && typeof error.type === "string" ? error.type : null;
    if (named) return `Request failed (${named}).`;
  }
  return "Request failed.";
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    throw new Error(describeError(error));
  }
  const raw = await response.text();
  let payload: (T & { error?: string }) | null = null;
  if (raw) {
    try {
      payload = JSON.parse(raw) as T & { error?: string };
    } catch {
      if (!response.ok) throw new Error(raw.slice(0, 240) || "Request failed.");
      throw new Error("The server returned an invalid JSON response.");
    }
  }
  if (!response.ok) throw new Error(payload?.error ?? raw ?? "Request failed.");
  if (payload === null) throw new Error("The server returned an empty response.");
  return payload;
}

function getFileName(fullPath: string) {
  const segments = fullPath.split("/");
  return segments[segments.length - 1] ?? fullPath;
}

export function LaunchctlApp() {
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [doctor, setDoctor] = useState<DoctorResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>("all");
  const [showOnlyWritable, setShowOnlyWritable] = useState(false);
  const [excludeWords, setExcludeWords] = useState<string[]>([]);
  const [excludeInput, setExcludeInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionName | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeTab, setActiveTab] = useState("overview");

  const selectedService = services.find((s) => s.id === selectedId) ?? null;
  const filteredServices = services.filter((service) => {
    const haystack = [service.label, service.path, service.program, service.programArguments.join(" ")]
      .join(" ")
      .toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (excludeWords.some((word) => haystack.includes(word.toLowerCase()))) return false;
    if (stateFilter !== "all" && service.state !== stateFilter) return false;
    if (sourceFilter === "custom" && service.isApple) return false;
    if (sourceFilter === "apple" && !service.isApple) return false;
    if (familyFilter !== "all" && service.plistDomain !== familyFilter) return false;
    if (showOnlyWritable && !service.isWritable) return false;
    return true;
  });

  const hasActiveFilters =
    stateFilter !== "all" ||
    sourceFilter !== "all" ||
    familyFilter !== "all" ||
    showOnlyWritable ||
    search !== "" ||
    excludeWords.length > 0;

  function pushToast(title: string, message: string, tone: "success" | "error") {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, title, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 4000);
  }

  function clearFilters() {
    setSearch("");
    setStateFilter("all");
    setSourceFilter("all");
    setFamilyFilter("all");
    setShowOnlyWritable(false);
    setExcludeWords([]);
  }

  function addExcludeWord() {
    if (excludeInput.trim()) {
      setExcludeWords((current) => [...current, excludeInput.trim()]);
      setExcludeInput("");
    }
  }

  function removeExcludeWord(word: string) {
    setExcludeWords((current) => current.filter((w) => w !== word));
  }

  const loadServices = useCallback(async (): Promise<ServiceSummary[]> => {
    setLoading(true);
    try {
      const [{ services: nextServices }, nextDoctor] = await Promise.all([
        readJson<{ services: ServiceSummary[] }>("/api/services"),
        readJson<DoctorResult>("/api/doctor"),
      ]);
      setServices(nextServices);
      setDoctor(nextDoctor);
      setSelectedId((current) => {
        if (!current) return nextServices[0]?.id ?? null;
        return nextServices.some((s) => s.id === current) ? current : (nextServices[0]?.id ?? null);
      });
      return nextServices;
    } catch (error) {
      pushToast("Failed to load services", describeError(error), "error");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const nextDetail = await readJson<ServiceDetail>(`/api/services/${id}`);
      setDetail(nextDetail);
      setEditorValue(nextDetail.rawPlist ?? "");
    } catch (error) {
      setDetail(null);
      setEditorValue("");
      pushToast("Failed to load detail", describeError(error), "error");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  useEffect(() => {
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      event.preventDefault();
      pushToast("Unexpected client error", describeError(event.reason), "error");
    }
    function handleWindowError(event: ErrorEvent) {
      const message = event.error ? describeError(event.error) : event.message || describeError(event);
      if (!message || message === "Script error.") return;
      pushToast("Unexpected client error", message, "error");
    }
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleWindowError);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleWindowError);
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setEditorValue("");
      return;
    }
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    if (!selectedId && filteredServices[0]) setSelectedId(filteredServices[0].id);
    if (selectedId && !filteredServices.some((s) => s.id === selectedId)) {
      setSelectedId(filteredServices[0]?.id ?? null);
    }
  }, [filteredServices, selectedId]);

  async function confirmAction() {
    if (!pendingAction || !selectedService) return;
    setActionBusy(true);
    try {
      const result = await readJson<ActionResult>(`/api/services/${pendingAction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: selectedService.path,
          label: selectedService.label,
          domain: selectedService.suggestedDomain,
        }),
      });
      pushToast(
        `${pendingAction} complete`,
        result.stderr || result.stdout || `Ran ${result.command.join(" ")}`,
        result.ok ? "success" : "error",
      );
      setPendingAction(null);
      const refreshedServices = await loadServices();
      const nextSelectedId = refreshedServices.some((s) => s.id === selectedService.id)
        ? selectedService.id
        : null;
      if (!nextSelectedId) {
        setDetail(null);
        setEditorValue("");
        return;
      }
      await loadDetail(nextSelectedId);
    } catch (error) {
      pushToast(`${pendingAction} failed`, describeError(error), "error");
    } finally {
      setActionBusy(false);
    }
  }

  async function savePlist() {
    if (!detail?.service.path) return;
    setSaving(true);
    try {
      const result = await readJson<{ backupPath: string }>("/api/plist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: detail.service.path, content: editorValue }),
      });
      pushToast("Plist saved", `Backup written to ${result.backupPath}`, "success");
      await loadServices();
      await loadDetail(detail.service.id);
    } catch (error) {
      pushToast("Save failed", describeError(error), "error");
    } finally {
      setSaving(false);
    }
  }

  function handleListKeyDown(event: React.KeyboardEvent) {
    if (!filteredServices.length) return;
    const currentIndex = filteredServices.findIndex((s) => s.id === selectedId);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = filteredServices[Math.min(currentIndex + 1, filteredServices.length - 1)];
      if (next) setSelectedId(next.id);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = filteredServices[Math.max(currentIndex - 1, 0)];
      if (prev) setSelectedId(prev.id);
    }
  }

  const issueCount = doctor
    ? doctor.duplicateLabels.length + doctor.loadedWithoutPlist.length + doctor.disabledButLoaded.length
    : 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-50 text-foreground">
      {/* App header */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/50 bg-white/80 backdrop-blur-sm px-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
              <Terminal className="h-5 w-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight text-slate-900">launchctl</span>
              <span className="text-xs text-slate-500">Helper</span>
            </div>
          </div>
          <Separator orientation="vertical" className="h-6 bg-slate-200" />
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <StatDot color="emerald" label={`${services.filter((s) => s.state === "running").length} running`} />
            <StatDot color="amber" label={`${services.filter((s) => s.state === "loaded").length} loaded`} />
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-100">
              <Shield className="h-3 w-3 text-slate-600" />
              {services.filter((s) => !s.isApple).length} custom
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {issueCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 shadow-sm">
              <AlertTriangle className="h-3.5 w-3.5" />
              {issueCount} {issueCount === 1 ? "issue" : "issues"}
            </div>
          )}
          <Button size="sm" variant="outline" className="h-9 text-xs gap-1.5" onClick={() => void loadServices()} disabled={loading}>
            <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden gap-4 p-4">
        {/* Left: service list + filters */}
        <aside className="flex w-96 shrink-0 flex-col border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
          {/* Filters */}
          <div className="shrink-0 space-y-3 border-b border-slate-200 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search services…"
                className="h-10 pl-10 pr-10 text-sm border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as StateFilter)}>
                <SelectTrigger className="h-9 text-xs border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All states</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="loaded">Loaded</SelectItem>
                  <SelectItem value="unloaded">Unloaded</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
                <SelectTrigger className="h-9 text-xs border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="custom">Custom only</SelectItem>
                  <SelectItem value="apple">Apple only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={familyFilter} onValueChange={(v) => setFamilyFilter(v as FamilyFilter)}>
                <SelectTrigger className="h-9 text-xs border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All families</SelectItem>
                  <SelectItem value="user-agent">User agents</SelectItem>
                  <SelectItem value="global-agent">Global agents</SelectItem>
                  <SelectItem value="system">Daemons</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-slate-600 hover:text-slate-900">
                <Switch checked={showOnlyWritable} onCheckedChange={setShowOnlyWritable} className="scale-90" />
                Writable only
              </label>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-slate-100 hover:text-slate-900 transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </button>
                )}
                <span className="font-mono text-slate-600">{filteredServices.length}/{services.length}</span>
              </div>
            </div>

            {/* Exclude words */}
            <div className="space-y-2 border-t border-slate-200 pt-3">
              <label className="block text-xs font-semibold text-slate-900">Exclude words</label>
              <div className="flex gap-2">
                <Input
                  value={excludeInput}
                  onChange={(e) => setExcludeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addExcludeWord();
                    }
                  }}
                  placeholder="Add word to filter…"
                  className="h-8 text-xs border-slate-200"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  onClick={addExcludeWord}
                  disabled={!excludeInput.trim()}
                >
                  Add
                </Button>
              </div>
              {excludeWords.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {excludeWords.map((word) => (
                    <Badge key={word} variant="secondary" className="text-xs gap-1.5 pl-2 pr-1">
                      {word}
                      <button
                        type="button"
                        onClick={() => removeExcludeWord(word)}
                        className="hover:text-slate-700"
                        aria-label={`Remove ${word}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* List */}
          <ScrollArea className="flex-1">
            <div
              role="listbox"
              aria-label="Service list"
              tabIndex={0}
              onKeyDown={handleListKeyDown}
              className="outline-none"
            >
              {loading ? (
                <div className="flex h-32 items-center justify-center text-sm text-slate-500 gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading services…
                </div>
              ) : filteredServices.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-slate-500 p-4">
                  <Search className="h-8 w-8 opacity-20" />
                  No services found
                  {hasActiveFilters && (
                    <button type="button" onClick={clearFilters} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                      Clear filters
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1 p-2">
                  {filteredServices.map((service) => (
                    <ServiceListItem
                      key={service.id}
                      service={service}
                      selected={selectedId === service.id}
                      onSelect={() => setSelectedId(service.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* Right: detail panel */}
        <main className="flex flex-1 flex-col overflow-hidden border border-slate-200 rounded-xl bg-white shadow-sm">
          {selectedService ? (
            <>
              {/* Detail header */}
              <div className="shrink-0 border-b border-slate-200 px-6 py-5">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <StateIndicatorDot state={selectedService.state} />
                      <div>
                        <h2 className="truncate font-mono text-base font-semibold text-slate-900">
                          {selectedService.label}
                        </h2>
                        <p className="mt-1 truncate text-xs text-slate-500">{selectedService.path}</p>
                      </div>
                      {detailLoading && (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400 ml-auto" />
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge
                        variant={
                          selectedService.state === "running"
                            ? "success"
                            : selectedService.state === "loaded"
                              ? "warning"
                              : "outline"
                        }
                        className="text-xs"
                      >
                        {selectedService.state}
                        {selectedService.pid ? ` · PID ${selectedService.pid}` : ""}
                      </Badge>
                      <Badge variant={selectedService.isApple ? "secondary" : "default"} className="text-xs">
                        {selectedService.isApple ? "Apple" : selectedService.sourceKind}
                      </Badge>
                      <Badge variant="outline" className="text-xs">{selectedService.plistDomain}</Badge>
                      {selectedService.disabled && <Badge variant="destructive" className="text-xs">disabled</Badge>}
                      {selectedService.isWritable && (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700 text-xs">
                          editable
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Action buttons — grouped by function */}
                  <div className="flex shrink-0 flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <span className="w-16 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Control
                      </span>
                      <Button size="sm" className="h-8 text-xs px-3 bg-blue-600 hover:bg-blue-700" onClick={() => setPendingAction("load")}>
                        Load
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs px-3 text-red-600 hover:bg-red-50 border-red-200"
                        onClick={() => setPendingAction("unload")}
                      >
                        Unload
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-16 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Boot
                      </span>
                      <Button size="sm" variant="outline" className="h-8 text-xs px-3" onClick={() => setPendingAction("enable")}>
                        Enable
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs px-3 text-red-600 hover:bg-red-50 border-red-200"
                        onClick={() => setPendingAction("disable")}
                      >
                        Disable
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex flex-1 flex-col overflow-hidden"
              >
                <div className="shrink-0 border-b border-slate-200 px-6 pt-4">
                  <TabsList className="h-9 bg-slate-100 p-0.5">
                    <TabsTrigger value="overview" className="text-xs font-medium data-[state=active]:bg-white data-[state=active]:text-slate-900">Overview</TabsTrigger>
                    <TabsTrigger value="plist" className="text-xs font-medium data-[state=active]:bg-white data-[state=active]:text-slate-900">Plist Editor</TabsTrigger>
                    <TabsTrigger value="print" className="text-xs font-medium data-[state=active]:bg-white data-[state=active]:text-slate-900">launchctl print</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="overview" className="mt-0 flex-1 overflow-y-auto p-6 data-[state=inactive]:hidden">
                  {detail?.service ? (
                    <div className="space-y-5">
                      <InfoTable detail={detail} />
                      {issueCount > 0 && (
                        <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 text-sm text-orange-900">
                          <p className="font-semibold">Doctor detected {issueCount} {issueCount === 1 ? "issue" : "issues"}.</p>
                          <p className="mt-2 text-orange-800 text-xs leading-relaxed">
                            Duplicate labels: {doctor?.duplicateLabels.length ?? 0} · Orphaned: {doctor?.loadedWithoutPlist.length ?? 0} · Disabled+live: {doctor?.disabledButLoaded.length ?? 0}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : detailLoading ? (
                    <div className="flex h-40 items-center justify-center text-sm text-slate-500 gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading…
                    </div>
                  ) : (
                    <EmptyState text="Select a service to view its details." />
                  )}
                </TabsContent>

                <TabsContent value="plist" className="mt-0 flex flex-1 flex-col gap-4 overflow-hidden p-6 data-[state=inactive]:hidden">
                  <div className="flex shrink-0 items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Plist Editor</p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Saves a timestamped backup alongside the original file.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void savePlist()}
                      disabled={!detail?.service.isWritable || saving || !detail}
                      className="gap-2"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save
                    </Button>
                  </div>
                  <Textarea
                    value={editorValue}
                    onChange={(e) => setEditorValue(e.target.value)}
                    className="plist-editor flex-1 resize-none font-mono text-sm leading-6 border-slate-200 focus:ring-2 focus:ring-blue-500"
                    disabled={!detail?.service.isWritable}
                    spellCheck={false}
                    wrap="off"
                  />
                  {!detail?.service.isWritable && detail && (
                    <p className="shrink-0 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-3 py-2">
                      This plist is protected and cannot be edited from the current session.
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="print" className="mt-0 flex-1 overflow-y-auto p-6 data-[state=inactive]:hidden">
                  <div className="space-y-4">
                    {detail?.printResults.length ? (
                      detail.printResults.map((entry) => (
                        <div key={entry.domain} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-sm font-semibold text-slate-900">{entry.domain}</p>
                            <Badge variant={entry.ok ? "success" : "destructive"} className="text-xs">
                              {entry.ok ? "loaded" : "no match"}
                            </Badge>
                          </div>
                          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-slate-600 bg-slate-50 rounded p-3 border border-slate-200">
                            {entry.stdout || entry.stderr || "No output"}
                          </pre>
                        </div>
                      ))
                    ) : (
                      <EmptyState text="launchctl print output will appear here." />
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-slate-400">
              <Terminal className="h-12 w-12 opacity-20" />
              <p className="text-sm font-medium">Select a service from the list</p>
            </div>
          )}
        </main>
      </div>

      {/* Confirm action dialog */}
      <Dialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg capitalize text-slate-900">Confirm {pendingAction}</DialogTitle>
            <DialogDescription className="text-slate-600">
              {selectedService
                ? `Run launchctl ${pendingAction} against ${selectedService.label} in ${selectedService.suggestedDomain}.`
                : "No service selected."}
            </DialogDescription>
          </DialogHeader>
          {selectedService && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="font-mono text-sm font-semibold text-slate-900">{selectedService.label}</p>
              <p className="mt-2 break-all text-xs text-slate-600">{selectedService.path}</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPendingAction(null)} className="border-slate-200">
              Cancel
            </Button>
            <Button
              variant={pendingAction === "disable" || pendingAction === "unload" ? "destructive" : "default"}
              disabled={actionBusy}
              onClick={() => void confirmAction()}
              className="gap-2"
            >
              {actionBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm {pendingAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast stack */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[200] flex w-full max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto rounded-lg border p-4 shadow-lg backdrop-blur-sm animate-in slide-in-from-right",
              toast.tone === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : "border-red-300 bg-red-50 text-red-900",
            )}
          >
            <p className="text-sm font-semibold">{toast.title}</p>
            <p className="mt-1 text-xs opacity-85">{toast.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StateIndicatorDot({ state }: { state: "running" | "loaded" | "unloaded" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full shadow-sm",
        state === "running" && "bg-emerald-500 shadow-emerald-500/50",
        state === "loaded" && "bg-amber-500 shadow-amber-500/50",
        state === "unloaded" && "bg-slate-300 shadow-slate-300/50",
      )}
    />
  );
}

function StatDot({ color, label }: { color: "emerald" | "amber"; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn("h-2 w-2 rounded-full", color === "emerald" ? "bg-emerald-500" : "bg-amber-500")} />
      <span className="text-xs font-medium text-slate-700">{label}</span>
    </span>
  );
}

function ServiceListItem({
  service,
  selected,
  onSelect,
}: {
  service: ServiceSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const fileName = getFileName(service.path);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-2.5 text-left rounded-lg transition-all",
        selected
          ? "bg-blue-50 border border-blue-200"
          : "hover:bg-slate-50 border border-transparent",
      )}
    >
      <span className="mt-0.5 shrink-0">
        <StateIndicatorDot state={service.state} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-mono text-xs font-semibold", selected ? "text-blue-900" : "text-slate-900")}>
          {service.label}
        </p>
        <p className="truncate text-xs text-slate-500 mt-0.5">{fileName}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
        {!service.isApple && (
          <span className="text-[10px] font-medium text-blue-600">{service.sourceKind}</span>
        )}
        {service.disabled && <span className="text-[10px] text-red-600 font-medium">disabled</span>}
        {service.isWritable && <span className="text-[10px] text-emerald-600 font-medium">editable</span>}
      </div>
    </button>
  );
}

function InfoTable({ detail }: { detail: ServiceDetail }) {
  const rows: Array<{ icon: React.ComponentType<{ className?: string }>; label: string; value: string }> = [
    {
      icon: Cpu,
      label: "Program",
      value: detail.service.program || detail.service.programArguments.join(" ") || "—",
    },
    { icon: Power, label: "State", value: `${detail.service.state}${detail.service.pid ? ` (PID ${detail.service.pid})` : ""}` },
    { icon: FolderCog, label: "Family", value: detail.service.plistDomain },
    { icon: Eye, label: "Disabled", value: detail.service.disabled === null ? "unknown" : detail.service.disabled ? "yes" : "no" },
    { icon: Power, label: "KeepAlive", value: detail.service.keepAlive },
    { icon: Power, label: "RunAtLoad", value: detail.service.runAtLoad === null ? "unknown" : detail.service.runAtLoad ? "yes" : "no" },
    { icon: FileCode2, label: "Plist format", value: detail.plistFormat },
    {
      icon: Power,
      label: "Last exit",
      value: detail.service.lastExitStatus !== null ? String(detail.service.lastExitStatus) : "—",
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      {rows.map((row, index) => {
        const Icon = row.icon;
        return (
          <div
            key={row.label}
            className={cn(
              "grid grid-cols-[16px_130px_1fr] items-baseline gap-3 px-4 py-3 text-sm",
              index % 2 === 0 ? "bg-slate-50" : "bg-white",
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600">{row.label}</span>
            <span className="break-all font-mono text-xs text-slate-900">{row.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
      {text}
    </div>
  );
}
