import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy, Download, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type IssueLevel = "ok" | "warn" | "error";

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={!value}
      onClick={() => {
        if (!value) return;
        navigator.clipboard.writeText(value).catch(() => {});
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary/60 disabled:opacity-45",
        copied && "animate-copy-flash",
      )}
    >
      {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
      {copied ? "Copied" : label}
    </button>
  );
}

function DownloadButton({ value, filename, label = "Download" }: { value: string; filename: string; label?: string }) {
  return (
    <button
      type="button"
      disabled={!value}
      onClick={() => {
        const blob = new Blob([value], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary/60 disabled:opacity-45"
    >
      <Download size={14} />
      {label}
    </button>
  );
}

function ClientOnlyNote({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/[0.05] px-3 py-2 text-[12.5px] leading-snug text-foreground">
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.10em] text-accent">Browser-only</span>
      <span className="mx-2 text-muted-foreground">/</span>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.10em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function TextArea({
  value,
  onChange,
  rows = 12,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      spellCheck={false}
      placeholder={placeholder}
      className="w-full resize-y rounded-lg border border-border bg-card p-3 font-mono text-[13px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-accent"
    />
  );
}

function OutputBox({ value, minHeight = "min-h-[220px]" }: { value: string; minHeight?: string }) {
  return (
    <pre className={cn("overflow-auto rounded-lg border border-border bg-paper-2/45 p-3 font-mono text-[13px] leading-relaxed text-foreground", minHeight)}>
      {value || <span className="text-muted-foreground">Output will appear here.</span>}
    </pre>
  );
}

function SplitTool({
  note,
  left,
  right,
}: {
  note: string;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <ClientOnlyNote>{note}</ClientOnlyNote>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card/60 p-4">{left}</div>
        <div className="rounded-2xl border border-border bg-card/60 p-4">{right}</div>
      </div>
    </div>
  );
}

function statusClass(level: IssueLevel) {
  if (level === "error") return "border-red-500/30 bg-red-500/10 text-red-200";
  if (level === "warn") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
}

const SQL_KEYWORDS = [
  "select", "from", "where", "group by", "order by", "having", "limit", "offset", "inner join",
  "left join", "right join", "full join", "cross join", "join", "on", "union", "values", "insert into",
  "update", "set", "delete from", "create table", "alter table",
];

function uppercaseOutsideQuotes(input: string) {
  let out = "";
  let quote = "";
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if ((ch === "'" || ch === '"' || ch === "`") && input[i - 1] !== "\\") {
      quote = quote === ch ? "" : quote || ch;
    }
    out += quote ? ch : ch;
  }
  return out;
}

function formatSql(input: string) {
  const compact = uppercaseOutsideQuotes(input).replace(/\s+/g, " ").trim();
  if (!compact) return "";
  let formatted = compact;
  for (const keyword of SQL_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword.replace(" ", "\\s+")}\\b`, "gi");
    formatted = formatted.replace(pattern, match => `\n${match.toUpperCase().replace(/\s+/g, " ")}`);
  }
  formatted = formatted
    .replace(/,\s*/g, ",\n  ")
    .replace(/\s+(AND|OR)\s+/gi, "\n  $1 ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
  return formatted;
}

function formatGraphql(input: string) {
  let out = "";
  let indent = 0;
  let quote = "";
  let escape = false;
  const pad = () => "  ".repeat(Math.max(0, indent));
  for (const ch of input.trim()) {
    if (quote) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") {
      out = out.trimEnd() + ` ${ch}\n`;
      indent += 1;
      out += pad();
    } else if (ch === "}" || ch === "]" || ch === ")") {
      indent -= 1;
      out = out.trimEnd() + `\n${pad()}${ch}`;
    } else if (ch === ",") {
      out = out.trimEnd() + ",\n" + pad();
    } else if (/\s/.test(ch)) {
      if (!out.endsWith(" ") && !out.endsWith("\n")) out += " ";
    } else {
      out += ch;
    }
  }
  return out.replace(/\s+\n/g, "\n").trim();
}

function parseCronField(field: string, min: number, max: number) {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step in "${part}"`);
    let start = min;
    let end = max;
    if (rangePart !== "*") {
      const [a, b] = rangePart.split("-");
      start = Number(a);
      end = b === undefined ? start : Number(b);
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`Invalid range "${part}"`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

function describeCronField(field: string, label: string, unit: string) {
  if (field === "*") return `Every ${unit}`;
  if (/^\*\/\d+$/.test(field)) return `Every ${field.slice(2)} ${unit}s`;
  if (/^\d+$/.test(field)) return `${label} ${field}`;
  return `${label}s ${field}`;
}

function nextCronRuns(expr: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Use standard 5-field cron: minute hour day month weekday");
  const [minRaw, hourRaw, dayRaw, monthRaw, weekdayRaw] = parts;
  const minutes = parseCronField(minRaw, 0, 59);
  const hours = parseCronField(hourRaw, 0, 23);
  const days = parseCronField(dayRaw, 1, 31);
  const months = parseCronField(monthRaw, 1, 12);
  const weekdays = parseCronField(weekdayRaw, 0, 7);
  const runs: Date[] = [];
  const cursor = new Date();
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const maxChecks = 60 * 24 * 370;
  for (let i = 0; i < maxChecks && runs.length < 5; i += 1) {
    const weekday = cursor.getDay();
    const weekdayMatch = weekdays.has(weekday) || (weekday === 0 && weekdays.has(7));
    if (
      minutes.has(cursor.getMinutes()) &&
      hours.has(cursor.getHours()) &&
      days.has(cursor.getDate()) &&
      months.has(cursor.getMonth() + 1) &&
      weekdayMatch
    ) {
      runs.push(new Date(cursor));
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return runs;
}

function flattenObject(value: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      flattenObject(nested, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out[prefix] = value;
  }
  return out;
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function inferType(values: unknown[]) {
  const present = values.filter(v => v !== undefined && v !== null && v !== "");
  if (!present.length) return "empty";
  if (present.every(v => typeof v === "boolean" || /^(true|false)$/i.test(String(v)))) return "boolean";
  if (present.every(v => Number.isFinite(Number(v)))) return "number";
  if (present.every(v => !Number.isNaN(Date.parse(String(v))))) return "date";
  return "string";
}

function parseTomlValue(raw: string): unknown {
  const value = raw.trim();
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^\[.*\]$/.test(value)) return value.slice(1, -1).split(",").map(item => parseTomlValue(item.trim()));
  return value;
}

function toTomlValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(toTomlValue).join(", ")}]`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseToml(input: string) {
  const root: Record<string, unknown> = {};
  let section: Record<string, unknown> = root;
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = root;
      for (const part of sectionMatch[1].split(".")) {
        section[part] = (section[part] && typeof section[part] === "object") ? section[part] : {};
        section = section[part] as Record<string, unknown>;
      }
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) throw new Error(`Expected key = value: ${line}`);
    section[line.slice(0, eq).trim()] = parseTomlValue(line.slice(eq + 1));
  }
  return root;
}

function parseSimpleYaml(input: string) {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [{ indent: -1, obj: root }];
  for (const rawLine of input.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    if (!withoutComment.trim()) continue;
    const indent = withoutComment.match(/^ */)?.[0].length ?? 0;
    const line = withoutComment.trim();
    const colon = line.indexOf(":");
    if (colon < 0) throw new Error(`Expected key: value: ${line}`);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const target = stack[stack.length - 1].obj;
    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1).trim();
    if (!rawValue) {
      const nested: Record<string, unknown> = {};
      target[key] = nested;
      stack.push({ indent, obj: nested });
    } else {
      target[key] = parseTomlValue(rawValue);
    }
  }
  return root;
}

function objectToYaml(value: unknown, indent = 0): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return `${" ".repeat(indent)}${String(value ?? "")}`;
  return Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return `${" ".repeat(indent)}${key}:\n${objectToYaml(nested, indent + 2)}`;
    }
    return `${" ".repeat(indent)}${key}: ${Array.isArray(nested) ? `[${nested.join(", ")}]` : String(nested ?? "")}`;
  }).join("\n");
}

function objectToToml(value: Record<string, unknown>) {
  const lines: string[] = [];
  const walk = (obj: Record<string, unknown>, path: string[] = []) => {
    if (path.length) lines.push(`\n[${path.join(".")}]`);
    for (const [key, nested] of Object.entries(obj)) {
      if (nested && typeof nested === "object" && !Array.isArray(nested)) continue;
      lines.push(`${key} = ${toTomlValue(nested)}`);
    }
    for (const [key, nested] of Object.entries(obj)) {
      if (nested && typeof nested === "object" && !Array.isArray(nested)) walk(nested as Record<string, unknown>, [...path, key]);
    }
  };
  walk(value);
  return lines.join("\n").trim();
}

export function CronParserUI() {
  const [expr, setExpr] = useState("*/15 9-17 * * 1-5");
  const result = useMemo(() => {
    try {
      const parts = expr.trim().split(/\s+/);
      const runs = nextCronRuns(expr);
      return {
        level: "ok" as IssueLevel,
        summary: [
          describeCronField(parts[0], "Minute", "minute"),
          describeCronField(parts[1], "Hour", "hour"),
          describeCronField(parts[2], "Day of month", "day"),
          describeCronField(parts[3], "Month", "month"),
          describeCronField(parts[4], "Weekday", "weekday"),
        ],
        output: runs.map(date => date.toLocaleString()).join("\n") || "No matching run found in the next year.",
      };
    } catch (error) {
      return { level: "error" as IssueLevel, summary: [(error as Error).message], output: "" };
    }
  }, [expr]);
  return (
    <div className="space-y-4">
      <ClientOnlyNote>Parses standard 5-field cron locally and previews the next runs using your browser time zone.</ClientOnlyNote>
      <div className="rounded-2xl border border-border bg-card/60 p-4">
        <Field label="Cron expression">
          <input value={expr} onChange={e => setExpr(e.target.value)} className="w-full rounded-lg border border-border bg-card p-3 font-mono text-[15px] outline-none focus:border-accent" />
        </Field>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cn("rounded-2xl border p-4", statusClass(result.level))}>
          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.10em]">Meaning</p>
          <ul className="space-y-1 text-[13px]">{result.summary.map(item => <li key={item}>{item}</li>)}</ul>
        </div>
        <div className="rounded-2xl border border-border bg-card/60 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">Next runs</p>
            <CopyButton value={result.output} />
          </div>
          <OutputBox value={result.output} minHeight="min-h-[128px]" />
        </div>
      </div>
    </div>
  );
}

export function SqlFormatterUI() {
  const [input, setInput] = useState("select id, email, created_at from users where active = true and created_at > now() - interval '30 days' order by created_at desc limit 25;");
  const output = useMemo(() => formatSql(input), [input]);
  return (
    <SplitTool
      note="Formats SQL text in the browser with keyword line breaks and readable clause grouping."
      left={<Field label="SQL input"><TextArea value={input} onChange={setInput} /></Field>}
      right={<><div className="mb-2 flex items-center justify-between"><span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">Formatted SQL</span><CopyButton value={output} /></div><OutputBox value={output} /></>}
    />
  );
}

export function GraphqlFormatterUI() {
  const [input, setInput] = useState("query User($id: ID!){user(id:$id){id name posts(first:5){nodes{id title}}}}");
  const output = useMemo(() => formatGraphql(input), [input]);
  return (
    <SplitTool
      note="Pretty-prints GraphQL queries, mutations, fragments, and selection sets without sending them anywhere."
      left={<Field label="GraphQL input"><TextArea value={input} onChange={setInput} /></Field>}
      right={<><div className="mb-2 flex items-center justify-between"><span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">Formatted GraphQL</span><CopyButton value={output} /></div><OutputBox value={output} /></>}
    />
  );
}

export function YamlTomlConverterUI() {
  const [mode, setMode] = useState<"yaml-to-toml" | "toml-to-yaml">("yaml-to-toml");
  const [input, setInput] = useState("app:\n  name: privatools\n  port: 8000\nfeatures:\n  localOnly: true\n  retries: 3");
  const converted = useMemo(() => {
    try {
      return mode === "yaml-to-toml" ? objectToToml(parseSimpleYaml(input)) : objectToYaml(parseToml(input));
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }, [input, mode]);
  return (
    <div className="space-y-4">
      <ClientOnlyNote>Converts common flat and nested config shapes between YAML and TOML locally.</ClientOnlyNote>
      <div className="inline-flex rounded-lg border border-border bg-card p-1">
        {(["yaml-to-toml", "toml-to-yaml"] as const).map(option => (
          <button key={option} type="button" onClick={() => setMode(option)} className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium", mode === option ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
            {option === "yaml-to-toml" ? "YAML to TOML" : "TOML to YAML"}
          </button>
        ))}
      </div>
      <SplitTool
        note="Comments and advanced anchors are intentionally ignored; the output is meant for common app config."
        left={<Field label={mode === "yaml-to-toml" ? "YAML input" : "TOML input"}><TextArea value={input} onChange={setInput} /></Field>}
        right={<><div className="mb-2 flex items-center justify-between"><span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">Converted config</span><CopyButton value={converted} /></div><OutputBox value={converted} /></>}
      />
    </div>
  );
}

const GITIGNORE_TEMPLATES: Record<string, string[]> = {
  Node: ["node_modules/", "dist/", "build/", ".env", ".env.*", "npm-debug.log*", "pnpm-debug.log*", "yarn-debug.log*"],
  Python: ["__pycache__/", "*.py[cod]", ".pytest_cache/", ".mypy_cache/", ".venv/", "venv/", "dist/", "*.egg-info/"],
  Vite: ["dist/", "dist-ssr/", "*.local"],
  Next: [".next/", "out/", "next-env.d.ts"],
  Docker: [".docker/", "docker-compose.override.yml", "*.pid"],
  macOS: [".DS_Store", ".AppleDouble", ".LSOverride"],
  Windows: ["Thumbs.db", "Desktop.ini", "$RECYCLE.BIN/"],
  Terraform: [".terraform/", "*.tfstate", "*.tfstate.*", ".terraform.lock.hcl"],
  Go: ["bin/", "*.test", "coverage.out"],
  Rust: ["target/", "Cargo.lock"],
};

export function GitignoreGeneratorUI() {
  const [selected, setSelected] = useState<string[]>(["Node", "Vite", "macOS"]);
  const output = useMemo(() => selected.map(name => `# ${name}\n${GITIGNORE_TEMPLATES[name].join("\n")}`).join("\n\n"), [selected]);
  return (
    <div className="space-y-4">
      <ClientOnlyNote>Generates a ready-to-save .gitignore from bundled templates. No external template API is called.</ClientOnlyNote>
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-border bg-card/60 p-4">
          <p className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">Templates</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.keys(GITIGNORE_TEMPLATES).map(name => (
              <label key={name} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px]", selected.includes(name) ? "border-accent/50 bg-accent/[0.07]" : "border-border hover:bg-secondary/50")}>
                <input type="checkbox" className="accent-[hsl(var(--accent))]" checked={selected.includes(name)} onChange={e => setSelected(prev => e.target.checked ? [...prev, name] : prev.filter(item => item !== name))} />
                {name}
              </label>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card/60 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">.gitignore</span>
            <div className="flex gap-2"><CopyButton value={output} /><DownloadButton value={output} filename=".gitignore" /></div>
          </div>
          <OutputBox value={output} />
        </div>
      </div>
    </div>
  );
}

function bumpSemver(version: string, kind: "major" | "minor" | "patch" | "prerelease") {
  const match = version.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) throw new Error("Use a version like 1.2.3 or v1.2.3-beta.1");
  let [, majorRaw, minorRaw, patchRaw, pre] = match;
  let major = Number(majorRaw);
  let minor = Number(minorRaw);
  let patch = Number(patchRaw);
  if (kind === "major") { major += 1; minor = 0; patch = 0; pre = undefined; }
  if (kind === "minor") { minor += 1; patch = 0; pre = undefined; }
  if (kind === "patch") { patch += 1; pre = undefined; }
  if (kind === "prerelease") {
    if (!pre) pre = "beta.1";
    else pre = pre.replace(/(\d+)$/, n => String(Number(n) + 1));
  }
  return `${major}.${minor}.${patch}${pre ? `-${pre}` : ""}`;
}

export function SemverBumperUI() {
  const [version, setVersion] = useState("1.4.9");
  const rows = useMemo(() => (["patch", "minor", "major", "prerelease"] as const).map(kind => {
    try { return [kind, bumpSemver(version, kind)] as const; } catch (error) { return [kind, (error as Error).message] as const; }
  }), [version]);
  return (
    <div className="space-y-4">
      <ClientOnlyNote>Calculates SemVer bumps locally for release notes, package manifests, and changelog prep.</ClientOnlyNote>
      <div className="rounded-2xl border border-border bg-card/60 p-4">
        <Field label="Current version">
          <input value={version} onChange={e => setVersion(e.target.value)} className="w-full rounded-lg border border-border bg-card p-3 font-mono text-[15px] outline-none focus:border-accent" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map(([kind, value]) => (
          <div key={kind} className="rounded-2xl border border-border bg-card/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">{kind}</span>
              <CopyButton value={value} />
            </div>
            <p className="font-mono text-[22px] text-foreground">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseEnv(input: string) {
  const issues: Array<{ level: IssueLevel; text: string }> = [];
  const seen = new Map<string, number>();
  const validName = /^[A-Za-z_][A-Za-z0-9_]*$/;
  input.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq < 0) {
      issues.push({ level: "error", text: `Line ${lineNo}: missing =` });
      return;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (!validName.test(key)) issues.push({ level: "error", text: `Line ${lineNo}: invalid variable name ${key}` });
    if (seen.has(key)) issues.push({ level: "warn", text: `Line ${lineNo}: duplicate key ${key}, first seen on line ${seen.get(key)}` });
    seen.set(key, lineNo);
    if (value === "") issues.push({ level: "warn", text: `Line ${lineNo}: ${key} has an empty value` });
    if (/\s/.test(value) && !/^(['"]).*\1$/.test(value)) issues.push({ level: "warn", text: `Line ${lineNo}: quote values that contain spaces` });
    if (/(SECRET|TOKEN|KEY|PASSWORD)/.test(key) && value.replace(/^['"]|['"]$/g, "").length < 12) issues.push({ level: "warn", text: `Line ${lineNo}: ${key} looks short for a secret` });
  });
  if (!issues.length) issues.push({ level: "ok", text: "No obvious .env issues found." });
  return issues;
}

export function EnvValidatorUI() {
  const [input, setInput] = useState("API_URL=https://privatools.me\nSECRET_KEY=change-me\nFEATURE_FLAG=true\nBAD NAME=value");
  const issues = useMemo(() => parseEnv(input), [input]);
  const report = issues.map(item => `[${item.level.toUpperCase()}] ${item.text}`).join("\n");
  return (
    <SplitTool
      note="Checks .env syntax, duplicate keys, empty values, unquoted spaces, and suspiciously short secrets locally."
      left={<Field label=".env input"><TextArea value={input} onChange={setInput} /></Field>}
      right={<><div className="mb-2 flex items-center justify-between"><span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">Validation report</span><CopyButton value={report} /></div><div className="space-y-2">{issues.map(item => <div key={item.text} className={cn("rounded-lg border px-3 py-2 text-[13px]", statusClass(item.level))}>{item.text}</div>)}</div></>}
    />
  );
}

export function JsonCsvSchemaUI() {
  const [input, setInput] = useState('[{"id":1,"email":"a@example.com","active":true},{"id":2,"email":"b@example.com","active":false,"plan":"pro"}]');
  const result = useMemo(() => {
    try {
      const parsed = JSON.parse(input);
      const rows = (Array.isArray(parsed) ? parsed : [parsed]).map(item => flattenObject(item));
      const columns = Array.from(rows.reduce((set, row) => {
        Object.keys(row).forEach(key => set.add(key));
        return set;
      }, new Set<string>()));
      const csv = [columns.join(","), ...rows.map(row => columns.map(key => csvEscape(row[key])).join(","))].join("\n");
      const schema = columns.map(key => {
        const values = rows.map(row => row[key]);
        const filled = values.filter(value => value !== undefined && value !== null && value !== "").length;
        return `${key}: ${inferType(values)} (${filled}/${rows.length} rows)`;
      }).join("\n");
      return { csv, schema, error: "" };
    } catch (error) {
      return { csv: "", schema: "", error: (error as Error).message };
    }
  }, [input]);
  return (
    <div className="space-y-4">
      <ClientOnlyNote>Flattens JSON objects, infers a lightweight schema, and exports CSV entirely in your browser.</ClientOnlyNote>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card/60 p-4">
          <Field label="JSON input"><TextArea value={input} onChange={setInput} rows={16} /></Field>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card/60 p-4">
            <div className="mb-2 flex items-center justify-between"><span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">Inferred schema</span><CopyButton value={result.schema} /></div>
            <OutputBox value={result.error || result.schema} minHeight="min-h-[140px]" />
          </div>
          <div className="rounded-2xl border border-border bg-card/60 p-4">
            <div className="mb-2 flex items-center justify-between gap-2"><span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">CSV output</span><div className="flex gap-2"><CopyButton value={result.csv} /><DownloadButton value={result.csv} filename="data.csv" /></div></div>
            <OutputBox value={result.csv} minHeight="min-h-[160px]" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function JsonToCsvSchemaUI() {
  return <JsonCsvSchemaUI />;
}
