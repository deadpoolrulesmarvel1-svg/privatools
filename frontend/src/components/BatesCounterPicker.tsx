/**
 * Bates matter picker.
 *
 * Discovery numbering is continuous *per matter* and must never be shared
 * across matters, so this is a list of named counters with one active — not a
 * single global counter. Picking a matter seeds the stamp settings from it, and
 * a confirmed stamp advances it, so numbering continues across documents and
 * across sessions. That continuity is the thing no competing tool offers, and
 * it is impossible without local storage.
 */
import { useCallback, useEffect, useState } from "react";
import { Plus, Scale } from "lucide-react";
import * as counters from "@/lib/localStore/counters";

export function BatesCounterPicker({
  onActivate,
}: {
  /** Called with the active counter whenever it changes, so the tool can seed its form. */
  onActivate: (counter: counters.BatesCounter | null) => void;
}) {
  const [list, setList] = useState<counters.BatesCounter[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const refresh = useCallback(
    async (announce = true) => {
      const [all, active] = await Promise.all([
        counters.listCounters(),
        counters.getActiveCounterId(),
      ]);
      setList(all);
      setActiveId(active);
      if (announce) onActivate(all.find((c) => c.id === active) ?? null);
    },
    [onActivate],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const c = await counters.createCounter({ name: trimmed });
    await counters.setActiveCounterId(c.id);
    setName("");
    setCreating(false);
    await refresh();
  };

  const activate = async (id: string) => {
    await counters.setActiveCounterId(id);
    await refresh();
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground flex items-center justify-between">
        <span>
          <span className="text-accent">§</span> Matter
        </span>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.10em] text-accent hover:underline"
          >
            <Plus size={11} aria-hidden="true" /> New matter
          </button>
        )}
      </div>

      <div className="p-4 space-y-2">
        {creating && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void create();
                }
              }}
              placeholder="e.g. Smith v. Acme"
              aria-label="Matter name"
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <button
              type="button"
              onClick={create}
              className="h-9 rounded-md border border-accent/40 bg-accent/10 px-3 text-[13px] font-medium text-accent hover:bg-accent/15"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setName("");
              }}
              className="h-9 px-2 text-[13px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}

        {list.length === 0 && !creating && (
          <p className="font-mono text-[10.5px] tracking-[0.04em] uppercase text-muted-foreground/85">
            <span className="text-accent">§</span> Create a matter to keep numbering continuous
            across documents
          </p>
        )}

        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => activate(c.id)}
            aria-pressed={c.id === activeId}
            className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors ${
              c.id === activeId
                ? "border-accent/40 bg-accent/[0.06]"
                : "border-border hover:bg-secondary/40"
            }`}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <Scale size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{c.name}</span>
            </span>
            <span className="shrink-0 font-mono text-[12px] text-accent">
              {counters.formatNext(c)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
