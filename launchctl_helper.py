#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import plistlib
import subprocess
import sys
import termios
import tty
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

try:
    from rich.console import Console
    from rich.prompt import Confirm, Prompt
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text
except ModuleNotFoundError as exc:
    missing = exc.name or "rich"
    print(
        f"Missing dependency: {missing}\n"
        "Install the project dependencies with:\n"
        "  uv sync",
        file=sys.stderr,
    )
    raise SystemExit(1)


console = Console()


SCAN_TARGETS = {
    "system": [
        Path("/System/Library/LaunchDaemons"),
        Path("/Library/LaunchDaemons"),
    ],
    "global-agent": [
        Path("/System/Library/LaunchAgents"),
        Path("/Library/LaunchAgents"),
    ],
    "user-agent": [
        Path.home() / "Library/LaunchAgents",
    ],
}


@dataclass(slots=True)
class ServiceRecord:
    label: str
    path: Path
    plist_domain: str
    suggested_domain: str
    program: str
    program_arguments: list[str]
    run_at_load: bool | None
    keep_alive: str
    disabled_hint: bool | None


@dataclass(slots=True)
class RuntimeStatus:
    pid: int | None
    last_exit_status: int | None


def run_command(args: list[str], check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True, check=check)


def read_key() -> str:
    fd = sys.stdin.fileno()
    if not sys.stdin.isatty():
        return sys.stdin.read(1)

    old_settings = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        first = sys.stdin.read(1)
        if first != "\x1b":
            return first
        second = sys.stdin.read(1)
        if second != "[":
            return first + second
        third = sys.stdin.read(1)
        return first + second + third
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


def current_uid() -> int:
    return os.getuid()


def gui_domain() -> str:
    return f"gui/{current_uid()}"


def user_domain() -> str:
    return f"user/{current_uid()}"


def domain_search_order() -> list[str]:
    return [gui_domain(), user_domain(), "system"]


def infer_domain_from_path(path: Path) -> str:
    expanded = path.expanduser().resolve()
    home = Path.home().resolve()
    if expanded.is_relative_to(home):
        return gui_domain()
    if "LaunchDaemons" in expanded.parts:
        return "system"
    if "LaunchAgents" in expanded.parts:
        return gui_domain()
    return gui_domain()


def prettify_keep_alive(value: object) -> str:
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, dict):
        return ", ".join(sorted(value)) or "dict"
    return str(value)


def load_plist(path: Path) -> dict | None:
    try:
        with path.open("rb") as handle:
            return plistlib.load(handle)
    except Exception:
        return None


def parse_service_record(path: Path, plist_domain: str) -> ServiceRecord | None:
    data = load_plist(path)
    if not isinstance(data, dict):
        return None
    label = data.get("Label")
    if not isinstance(label, str) or not label.strip():
        return None
    program = data.get("Program", "")
    program_arguments = data.get("ProgramArguments") or []
    if not isinstance(program_arguments, list):
        program_arguments = []
    return ServiceRecord(
        label=label,
        path=path,
        plist_domain=plist_domain,
        suggested_domain=infer_domain_from_path(path),
        program=program if isinstance(program, str) else "",
        program_arguments=[str(arg) for arg in program_arguments],
        run_at_load=data.get("RunAtLoad") if isinstance(data.get("RunAtLoad"), bool) else None,
        keep_alive=prettify_keep_alive(data.get("KeepAlive")),
        disabled_hint=data.get("Disabled") if isinstance(data.get("Disabled"), bool) else None,
    )


def scan_services() -> list[ServiceRecord]:
    records: list[ServiceRecord] = []
    for plist_domain, directories in SCAN_TARGETS.items():
        for directory in directories:
            if not directory.exists():
                continue
            for path in sorted(directory.glob("*.plist")):
                record = parse_service_record(path, plist_domain)
                if record:
                    records.append(record)
    return records


def scan_by_label(records: Iterable[ServiceRecord]) -> dict[str, list[ServiceRecord]]:
    index: dict[str, list[ServiceRecord]] = {}
    for record in records:
        index.setdefault(record.label, []).append(record)
    return index


def parse_launchctl_list() -> dict[str, RuntimeStatus]:
    proc = run_command(["launchctl", "list"])
    if proc.returncode != 0:
        return {}
    statuses: dict[str, RuntimeStatus] = {}
    for line in proc.stdout.splitlines():
        if not line.strip() or line.startswith("PID"):
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        pid_text, exit_text, label = parts[0].strip(), parts[1].strip(), parts[2].strip()
        pid = None if pid_text == "-" else int(pid_text)
        exit_status = None if exit_text == "-" else int(exit_text)
        statuses[label] = RuntimeStatus(pid=pid, last_exit_status=exit_status)
    return statuses


def parse_disabled(domain: str) -> dict[str, bool]:
    proc = run_command(["launchctl", "print-disabled", domain])
    if proc.returncode != 0:
        return {}
    disabled: dict[str, bool] = {}
    for raw_line in proc.stdout.splitlines():
        line = raw_line.strip().rstrip(",")
        if "=>" not in line or not line.startswith('"'):
            continue
        label_part, state_part = line.split("=>", 1)
        label = label_part.strip().strip('"')
        state = state_part.strip()
        if state == "disabled":
            disabled[label] = True
        elif state == "enabled":
            disabled[label] = False
    return disabled


def collect_disabled_maps() -> dict[str, dict[str, bool]]:
    return {
        gui_domain(): parse_disabled(gui_domain()),
        user_domain(): parse_disabled(user_domain()),
        "system": parse_disabled("system"),
    }


def determine_disabled(record: ServiceRecord, disabled_maps: dict[str, dict[str, bool]]) -> bool | None:
    if record.label in disabled_maps.get(record.suggested_domain, {}):
        return disabled_maps[record.suggested_domain][record.label]
    return record.disabled_hint


def service_target(domain: str, label: str) -> str:
    return f"{domain}/{label}"


def is_apple_plist(record: ServiceRecord) -> bool:
    try:
        return record.path.resolve().is_relative_to(Path("/System/Library"))
    except FileNotFoundError:
        return str(record.path).startswith("/System/Library/")


def get_runtime_state(record: ServiceRecord, runtime: dict[str, RuntimeStatus]) -> tuple[str, str]:
    status = runtime.get(record.label)
    if status and status.pid is not None:
        return "running", str(status.pid)
    if status:
        return "loaded", "-"
    return "unloaded", "-"


def sort_records(records: Iterable[ServiceRecord], runtime: dict[str, RuntimeStatus]) -> list[ServiceRecord]:
    order = {"running": 0, "loaded": 1, "unloaded": 2}
    return sorted(
        records,
        key=lambda item: (
            order[get_runtime_state(item, runtime)[0]],
            item.suggested_domain,
            item.label.lower(),
        ),
    )


def filter_records(
    records: Iterable[ServiceRecord],
    runtime: dict[str, RuntimeStatus],
    query: str | None = None,
    show_apple: bool = False,
) -> list[ServiceRecord]:
    lowered = query.lower().strip() if query else ""
    filtered: list[ServiceRecord] = []
    for record in records:
        if not show_apple and is_apple_plist(record):
            continue
        if lowered:
            haystack = " ".join([record.label, str(record.path), record.program, " ".join(record.program_arguments)]).lower()
            if lowered not in haystack:
                continue
        filtered.append(record)
    return sort_records(filtered, runtime)


def render_service_table(
    records: list[ServiceRecord],
    runtime: dict[str, RuntimeStatus],
    disabled_maps: dict[str, dict[str, bool]],
    title: str,
    query: str | None = None,
    show_apple: bool = False,
    running_only: bool = False,
    selected_index: int | None = None,
) -> None:
    view = filter_records(records, runtime, query=query, show_apple=show_apple)
    table = Table(title=title, show_lines=False)
    table.add_column("State")
    table.add_column("Label", style="cyan")
    table.add_column("PID", justify="right")
    table.add_column("Loaded")
    table.add_column("Domain")
    table.add_column("Source")
    table.add_column("Program")
    table.add_column("Disabled")

    for index, record in enumerate(view):
        state, pid_display = get_runtime_state(record, runtime)
        if running_only and state != "running":
            continue
        disabled = determine_disabled(record, disabled_maps)
        program = record.program or (" ".join(record.program_arguments[:2]) if record.program_arguments else "-")
        row_style = "bold black on bright_cyan" if selected_index is not None and index == selected_index else None
        table.add_row(
            state,
            record.label,
            pid_display,
            "yes" if state != "unloaded" else "no",
            record.suggested_domain,
            str(record.path),
            program,
            "-" if disabled is None else ("yes" if disabled else "no"),
            style=row_style,
        )

    console.print(table)


def print_overview(
    records: list[ServiceRecord],
    runtime: dict[str, RuntimeStatus],
    disabled_maps: dict[str, dict[str, bool]],
    running_only: bool,
    show_apple: bool = False,
) -> None:
    render_service_table(
        records,
        runtime,
        disabled_maps,
        title="launchd Services",
        show_apple=show_apple,
        running_only=running_only,
    )


def record_action_label(record: ServiceRecord, runtime: dict[str, RuntimeStatus]) -> str:
    state, _ = get_runtime_state(record, runtime)
    return "unload" if state in {"running", "loaded"} else "load"


def pick_record(index: dict[str, list[ServiceRecord]], target: str) -> ServiceRecord | None:
    matches = index.get(target, [])
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]

    table = Table(title=f"Multiple plist files match {target!r}")
    table.add_column("Choice")
    table.add_column("Domain")
    table.add_column("Path")
    for idx, record in enumerate(matches, start=1):
        table.add_row(str(idx), record.suggested_domain, str(record.path))
    console.print(table)
    console.print("[yellow]Be explicit with a path or use --domain for label-based operations.[/yellow]")
    return None


def print_record_details(record: ServiceRecord, runtime: dict[str, RuntimeStatus], disabled_maps: dict[str, dict[str, bool]]) -> None:
    status = runtime.get(record.label)
    disabled = determine_disabled(record, disabled_maps)
    state, pid_display = get_runtime_state(record, runtime)
    details = Table(show_header=False, box=None)
    details.add_column("Key", style="bold")
    details.add_column("Value")
    details.add_row("Label", record.label)
    details.add_row("Source", str(record.path))
    details.add_row("Suggested domain", record.suggested_domain)
    details.add_row("Plist family", record.plist_domain)
    details.add_row("Program", record.program or "-")
    details.add_row("Arguments", " ".join(record.program_arguments) if record.program_arguments else "-")
    details.add_row("RunAtLoad", "-" if record.run_at_load is None else str(record.run_at_load))
    details.add_row("KeepAlive", record.keep_alive)
    details.add_row("Disabled", "-" if disabled is None else ("yes" if disabled else "no"))
    details.add_row("State", state)
    details.add_row("PID", pid_display)
    if status:
        details.add_row("Last exit", "-" if status.last_exit_status is None else str(status.last_exit_status))
    console.print(Panel(details, title="Plist Metadata"))


def print_search_results(
    records: list[ServiceRecord],
    runtime: dict[str, RuntimeStatus],
    disabled_maps: dict[str, dict[str, bool]],
    query: str,
    show_apple: bool,
    selected_index: int | None = None,
) -> None:
    render_service_table(
        records,
        runtime,
        disabled_maps,
        title=f"Search results for {query!r}",
        query=query,
        show_apple=show_apple,
        selected_index=selected_index,
    )


def render_browser_header(
    query: str,
    show_apple: bool,
    total: int,
    visible: int,
    runtime: dict[str, RuntimeStatus],
    selected: ServiceRecord | None,
) -> None:
    running = sum(1 for status in runtime.values() if status.pid is not None)
    loaded = sum(1 for status in runtime.values() if status.pid is None)
    help_text = Text()
    help_text.append("↑/↓", style="bold")
    help_text.append(" move  ")
    help_text.append("enter", style="bold")
    help_text.append(" action  ")
    help_text.append("s", style="bold")
    help_text.append(" search  ")
    help_text.append("a", style="bold")
    help_text.append(" toggle Apple plists  ")
    help_text.append("d", style="bold")
    help_text.append(" details  ")
    help_text.append("l", style="bold")
    help_text.append(" load  ")
    help_text.append("u", style="bold")
    help_text.append(" unload  ")
    help_text.append("r", style="bold")
    help_text.append(" refresh  ")
    help_text.append("q", style="bold")
    help_text.append(" quit")

    query_text = repr(query) if query else "*"
    selected_text = selected.label if selected else "-"
    subtitle = f"query={query_text} | apple={'shown' if show_apple else 'hidden'} | runtime running={running} loaded={loaded} | visible={visible}/{total} | selected={selected_text}"
    console.print(Panel(help_text, title="launchctl Browser", subtitle=subtitle))


def interactive_browser(start_show_apple: bool = False) -> int:
    query = ""
    show_apple = start_show_apple
    selected_index = 0

    while True:
        records = scan_services()
        runtime = parse_launchctl_list()
        disabled_maps = collect_disabled_maps()
        visible = filter_records(records, runtime, query=query, show_apple=show_apple)
        if visible:
            selected_index = max(0, min(selected_index, len(visible) - 1))
            selected = visible[selected_index]
        else:
            selected_index = 0
            selected = None

        console.clear()
        render_browser_header(query, show_apple, len(records), len(visible), runtime, selected)
        render_service_table(
            records,
            runtime,
            disabled_maps,
            title="Services",
            query=query,
            show_apple=show_apple,
            selected_index=selected_index if visible else None,
        )

        key = read_key()
        if key in {"q", "\x03"}:
            return 0
        if key in {"\x1b[A", "k"}:
            selected_index = max(0, selected_index - 1)
            continue
        if key in {"\x1b[B", "j"}:
            selected_index = min(max(len(visible) - 1, 0), selected_index + 1)
            continue
        if key in {"\x1b[C", "\x1b[D"}:
            continue
        if key == "a":
            show_apple = not show_apple
            selected_index = 0
            continue
        if key == "r":
            continue
        if key == "s" or key == "/":
            query = console.input("Search: ").strip()
            selected_index = 0
            continue
        if key == "c":
            query = ""
            selected_index = 0
            continue
        if key == "d":
            if not selected:
                continue
            console.clear()
            print_record_details(selected, runtime, disabled_maps)
            render_print_results(launchctl_print(selected.label, None))
            console.input("Press Enter to return")
            continue
        if key == "l" and selected:
            if Confirm.ask(f"Load {selected.label}?", default=False):
                execute_load(selected.path, None, dry_run=False)
            continue
        if key == "u" and selected:
            if Confirm.ask(f"Unload {selected.label}?", default=False):
                execute_unload(selected.label, scan_by_label(records), None, dry_run=False)
            continue
        if key in {"\r", "\n"} and selected:
            state, _ = get_runtime_state(selected, runtime)
            label_index = scan_by_label(records)
            if state in {"running", "loaded"}:
                if Confirm.ask(f"Unload {selected.label}?", default=False):
                    execute_unload(selected.label, label_index, None, dry_run=False)
            else:
                if Confirm.ask(f"Load {selected.label}?", default=False):
                    execute_load(selected.path, None, dry_run=False)
            continue
        if key == "?":
            console.print(Panel("↑/↓ move | enter load/unload | l load | u unload | s search | a toggle Apple plists | d details | r refresh | q quit", title="Help"))
            console.input("Press Enter to continue")
            continue


def launchctl_print(label: str, domain: str | None) -> list[tuple[str, subprocess.CompletedProcess[str]]]:
    domains = [domain] if domain else domain_search_order()
    results: list[tuple[str, subprocess.CompletedProcess[str]]] = []
    for candidate in domains:
        proc = run_command(["launchctl", "print", service_target(candidate, label)])
        results.append((candidate, proc))
    return results


def render_print_results(results: list[tuple[str, subprocess.CompletedProcess[str]]]) -> None:
    shown = False
    for domain, proc in results:
        if proc.returncode == 0 and proc.stdout.strip():
            body = proc.stdout.strip()
            console.print(Panel(body, title=f"launchctl print {domain}", expand=False))
            shown = True
    if not shown:
        failures = Text()
        for domain, proc in results:
            stderr = proc.stderr.strip() or "no output"
            failures.append(f"{domain}: {stderr}\n")
        console.print(Panel(failures, title="No matching loaded service"))


def resolve_target(target: str, index: dict[str, list[ServiceRecord]]) -> tuple[str, Path | None, ServiceRecord | None]:
    maybe_path = Path(target).expanduser()
    if maybe_path.exists():
        record = parse_service_record(maybe_path, "manual") or None
        label = record.label if record else maybe_path.stem
        return label, maybe_path, record
    record = pick_record(index, target)
    return target, (record.path if record else None), record


def execute_load(path: Path, domain: str | None, dry_run: bool) -> int:
    chosen_domain = domain or infer_domain_from_path(path)
    command = ["launchctl", "bootstrap", chosen_domain, str(path)]
    if dry_run:
        console.print(f"[bold]Dry run:[/bold] {' '.join(command)}")
        return 0
    proc = run_command(command)
    if proc.returncode == 0:
        console.print(f"[green]Loaded[/green] {path} into {chosen_domain}")
        return 0
    console.print(Panel(proc.stderr.strip() or "bootstrap failed", title="launchctl bootstrap failed"))
    return proc.returncode


def execute_unload(target: str, index: dict[str, list[ServiceRecord]], domain: str | None, dry_run: bool) -> int:
    label, path, record = resolve_target(target, index)
    chosen_domain = domain or (record.suggested_domain if record else (infer_domain_from_path(path) if path else gui_domain()))
    if path:
        command = ["launchctl", "bootout", chosen_domain, str(path)]
    else:
        command = ["launchctl", "bootout", service_target(chosen_domain, label)]
    if dry_run:
        console.print(f"[bold]Dry run:[/bold] {' '.join(command)}")
        return 0
    proc = run_command(command)
    if proc.returncode == 0:
        console.print(f"[green]Unloaded[/green] {target} from {chosen_domain}")
        return 0
    console.print(Panel(proc.stderr.strip() or "bootout failed", title="launchctl bootout failed"))
    return proc.returncode


def execute_toggle(action: str, target: str, index: dict[str, list[ServiceRecord]], domain: str | None, dry_run: bool) -> int:
    label, _, record = resolve_target(target, index)
    chosen_domain = domain or (record.suggested_domain if record else gui_domain())
    command = ["launchctl", action, service_target(chosen_domain, label)]
    if dry_run:
        console.print(f"[bold]Dry run:[/bold] {' '.join(command)}")
        return 0
    proc = run_command(command)
    if proc.returncode == 0:
        console.print(f"[green]{action.title()}d[/green] {label} in {chosen_domain}")
        return 0
    console.print(Panel(proc.stderr.strip() or f"{action} failed", title=f"launchctl {action} failed"))
    return proc.returncode


def print_doctor(records: list[ServiceRecord], runtime: dict[str, RuntimeStatus], disabled_maps: dict[str, dict[str, bool]]) -> None:
    label_index = scan_by_label(records)

    duplicate_labels = {label: matches for label, matches in label_index.items() if len(matches) > 1}
    loaded_without_plist = sorted(label for label in runtime if label not in label_index)
    disabled_but_loaded = []

    for record in records:
        disabled = determine_disabled(record, disabled_maps)
        if disabled is False:
            continue
        status = runtime.get(record.label)
        if status:
            disabled_but_loaded.append(record)

    if duplicate_labels:
        table = Table(title="Duplicate Labels")
        table.add_column("Label", style="cyan")
        table.add_column("Paths")
        for label, matches in sorted(duplicate_labels.items()):
            table.add_row(label, "\n".join(str(item.path) for item in matches))
        console.print(table)
    else:
        console.print("[green]No duplicate labels found in scanned plist directories.[/green]")

    if loaded_without_plist:
        table = Table(title="Loaded But Not Found In Scanned Plist Directories")
        table.add_column("Label", style="cyan")
        table.add_column("PID", justify="right")
        for label in loaded_without_plist:
            status = runtime[label]
            table.add_row(label, "-" if status.pid is None else str(status.pid))
        console.print(table)
    else:
        console.print("[green]Every loaded service from `launchctl list` maps to a scanned plist or is absent from the current domain.[/green]")

    if disabled_but_loaded:
        table = Table(title="Disabled But Still Present In Current Runtime View")
        table.add_column("Label", style="cyan")
        table.add_column("Path")
        for record in disabled_but_loaded:
            table.add_row(record.label, str(record.path))
        console.print(table)
    else:
        console.print("[green]No disabled services appear in the current runtime list.[/green]")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect and manage launchctl services with Rich.")
    parser.set_defaults(command="ui", running=False, show_apple=False)
    subparsers = parser.add_subparsers(dest="command")

    list_parser = subparsers.add_parser("list", help="Show discovered plist files and current runtime state.")
    list_parser.add_argument("--running", action="store_true", help="Only show services with a running PID in `launchctl list`.")
    list_parser.add_argument("--show-apple", action="store_true", help="Include Apple plist files from /System/Library.")

    ui_parser = subparsers.add_parser("ui", help="Open the interactive Rich browser.")
    ui_parser.add_argument("--show-apple", action="store_true", help="Start with Apple plist files visible.")

    status_parser = subparsers.add_parser("status", help="Show metadata plus `launchctl print` for a label or plist path.")
    status_parser.add_argument("target", help="launchd label or path to a plist file")
    status_parser.add_argument("--domain", help="Explicit domain target, for example gui/501 or system.")

    load_parser = subparsers.add_parser("load", help="Bootstrap a plist into launchctl.")
    load_parser.add_argument("path", help="Path to a plist file")
    load_parser.add_argument("--domain", help="Explicit domain target, for example gui/501 or system.")
    load_parser.add_argument("--dry-run", action="store_true", help="Print the launchctl command without executing it.")

    unload_parser = subparsers.add_parser("unload", help="Boot out a loaded service by plist path or label.")
    unload_parser.add_argument("target", help="launchd label or path to a plist file")
    unload_parser.add_argument("--domain", help="Explicit domain target, for example gui/501 or system.")
    unload_parser.add_argument("--dry-run", action="store_true", help="Print the launchctl command without executing it.")

    enable_parser = subparsers.add_parser("enable", help="Enable a launchctl service target by label or plist path.")
    enable_parser.add_argument("target", help="launchd label or path to a plist file")
    enable_parser.add_argument("--domain", help="Explicit domain target, for example gui/501 or system.")
    enable_parser.add_argument("--dry-run", action="store_true", help="Print the launchctl command without executing it.")

    disable_parser = subparsers.add_parser("disable", help="Disable a launchctl service target by label or plist path.")
    disable_parser.add_argument("target", help="launchd label or path to a plist file")
    disable_parser.add_argument("--domain", help="Explicit domain target, for example gui/501 or system.")
    disable_parser.add_argument("--dry-run", action="store_true", help="Print the launchctl command without executing it.")

    find_parser = subparsers.add_parser("find", help="Find plist files for a label fragment.")
    find_parser.add_argument("query", help="Substring to match against launchd labels or source paths")

    subparsers.add_parser("doctor", help="Show duplicates, unmapped loaded services, and other quick checks.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    records = scan_services()
    runtime = parse_launchctl_list()
    disabled_maps = collect_disabled_maps()
    label_index = scan_by_label(records)

    command = args.command or "list"
    if command == "ui":
        return interactive_browser(start_show_apple=args.show_apple)
    if command == "list":
        print_overview(records, runtime, disabled_maps, running_only=args.running, show_apple=args.show_apple)
        return 0

    if command == "find":
        print_search_results(records, runtime, disabled_maps, args.query, show_apple=False)
        return 0

    if command == "doctor":
        print_doctor(records, runtime, disabled_maps)
        return 0

    if command == "status":
        label, path, record = resolve_target(args.target, label_index)
        if path and record is None:
            record = parse_service_record(path, "manual")
        if record:
            print_record_details(record, runtime, disabled_maps)
            label = record.label
        render_print_results(launchctl_print(label, args.domain))
        return 0

    if command == "load":
        return execute_load(Path(args.path).expanduser(), args.domain, args.dry_run)

    if command == "unload":
        return execute_unload(args.target, label_index, args.domain, args.dry_run)

    if command == "enable":
        return execute_toggle("enable", args.target, label_index, args.domain, args.dry_run)

    if command == "disable":
        return execute_toggle("disable", args.target, label_index, args.domain, args.dry_run)

    parser.print_help()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted.[/yellow]")
        raise SystemExit(130)
