import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type ProviderId = "auto" | "gemini" | "openai" | "anthropic" | "openrouter";

type ProviderConfig = {
  id: Exclude<ProviderId, "auto">;
  available: boolean;
  defaultModels: string[];
};

type ApiConfig = {
  providers: ProviderConfig[];
  providerCandidates: string[];
};

function prettyProvider(p: ProviderId | string) {
  const v = String(p || "").toLowerCase();
  if (v === "gemini") return "Gemini";
  if (v === "openai") return "OpenAI";
  if (v === "anthropic") return "Claude";
  if (v === "openrouter") return "OpenRouter";
  return "Auto";
}

function clampProvider(p?: string): ProviderId {
  const v = String(p || "auto").toLowerCase();
  if (v === "gemini" || v === "openai" || v === "anthropic" || v === "openrouter") return v;
  return "auto";
}

export function ModelPicker(props: {
  provider: ProviderId;
  model: string;
  onChange: (next: { provider: ProviderId; model: string }) => void;
}) {
  const { provider, model, onChange } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cfg, setCfg] = useState<ApiConfig | null>(null);
  const [cfgErr, setCfgErr] = useState<string | null>(null);
  const [placement, setPlacement] = useState<{ vertical: "down" | "up"; horizontal: "right" | "left" }>({
    vertical: "down",
    horizontal: "right",
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/config", { method: "GET" });
        const j = await r.json();
        if (!cancelled && j?.providers) {
          setCfg(j as ApiConfig);
          setCfgErr(null);
        }
      } catch (e: any) {
        if (!cancelled) setCfgErr(e?.message || "Failed to load config");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onDown(ev: MouseEvent) {
      if (!open) return;
      const el = rootRef.current;
      if (!el) return;
      if (!el.contains(ev.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const updatePlacement = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const menuHeight = 420;
      const menuWidth = Math.min(380, Math.max(260, window.innerWidth - 24));

      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const vertical = spaceBelow < menuHeight && spaceAbove > spaceBelow ? "up" : "down";

      // right: align panel right edge to trigger right edge. left: align panel left edge to trigger left edge.
      const roomRightAligned = rect.right;
      const roomLeftAligned = window.innerWidth - rect.left;
      const horizontal = roomRightAligned >= menuWidth || roomRightAligned >= roomLeftAligned ? "right" : "left";

      setPlacement({ vertical, horizontal });
    };

    updatePlacement();
    const t = window.setTimeout(() => searchRef.current?.focus(), 50);
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open]);

  const providers: ProviderConfig[] = useMemo(() => {
    if (cfg?.providers?.length) return cfg.providers;
    return [
      { id: "openai", available: true, defaultModels: ["gpt-4o-mini"] },
      { id: "anthropic", available: true, defaultModels: ["claude-3-5-sonnet-latest"] },
      { id: "gemini", available: true, defaultModels: ["gemini-1.5-flash", "gemini-1.5-pro"] },
      { id: "openrouter", available: true, defaultModels: ["openai/gpt-4o-mini"] },
    ];
  }, [cfg]);

  const currentProvider = clampProvider(provider);
  const currentModel = String(model || "auto");

  const flattened = useMemo(() => {
    const rows: Array<{ provider: ProviderConfig["id"]; model: string; available: boolean }> = [];
    for (const p of providers) {
      for (const m of p.defaultModels || []) {
        rows.push({ provider: p.id, model: m, available: !!p.available });
      }
    }
    return rows;
  }, [providers]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return flattened;
    return flattened.filter((r) => {
      return r.model.toLowerCase().includes(needle) || prettyProvider(r.provider).toLowerCase().includes(needle);
    });
  }, [flattened, q]);

  const activeText = useMemo(() => {
    if (currentProvider === "auto" || currentModel === "auto") return "Auto";
    return currentModel;
  }, [currentModel, currentProvider]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm transition"
        title="Select model"
      >
        <span className="text-sm font-semibold max-w-[210px] truncate">{activeText}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div
          className={`absolute z-50 w-[380px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden ${
            placement.vertical === "down" ? "top-full mt-2 origin-top" : "bottom-full mb-2 origin-bottom"
          } ${placement.horizontal === "right" ? "right-0" : "left-0"}`}
        >
          <div className="p-3 border-b border-slate-100">
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search model..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
            />
            {cfgErr ? (
              <div className="mt-2 text-[11px] text-amber-700">Config load failed: {cfgErr}</div>
            ) : null}
          </div>

          <div className="max-h-[360px] overflow-auto p-2">
            <button
              type="button"
              onClick={() => {
                onChange({ provider: "auto", model: "auto" });
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2.5 rounded-xl border mb-2 ${
                currentProvider === "auto"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div className="text-sm font-semibold">Auto</div>
              <div className={`text-[11px] ${currentProvider === "auto" ? "text-white/80" : "text-slate-500"}`}>
                Let the app choose provider/model
              </div>
            </button>

            {filtered.map((row) => {
              const active = currentProvider === row.provider && currentModel === row.model;
              return (
                <button
                  key={`${row.provider}:${row.model}`}
                  type="button"
                  disabled={!row.available}
                  onClick={() => {
                    onChange({ provider: row.provider, model: row.model });
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border mb-1 transition ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-transparent hover:bg-slate-50"
                  } ${!row.available ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold truncate">{row.model}</div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
                      {prettyProvider(row.provider)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="px-3 py-2 border-t border-slate-100 text-[11px] text-slate-500">
            Active: <span className="font-semibold text-slate-700">{activeText}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
