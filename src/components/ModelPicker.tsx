import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type ProviderId = "auto" | "openrouter" | "mistral" | "ollama" | "gemini" | "openai" | "anthropic";
const AUTO_FAST_MODEL = "auto-fast";
const AUTO_THINKING_MODEL = "auto-thinking";

function clampProvider(p?: string): ProviderId {
  const v = String(p || "auto").toLowerCase();
  if (v === "openrouter" || v === "mistral" || v === "ollama" || v === "gemini" || v === "openai" || v === "anthropic") return v;
  return "auto";
}

function normalizeModel(model?: string): string {
  const raw = String(model || "").trim();
  if (!raw || raw === "auto") return AUTO_FAST_MODEL;
  if (raw === AUTO_FAST_MODEL || raw === AUTO_THINKING_MODEL) return raw;
  return raw;
}

export function ModelPicker(props: {
  provider: ProviderId;
  model: string;
  onChange: (next: { provider: ProviderId; model: string }) => void;
}) {
  const { provider, model, onChange } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const currentProvider = clampProvider(provider);
  const selectedModel = normalizeModel(model);
  const inLegacyManual = currentProvider !== "auto"
    || (selectedModel !== AUTO_FAST_MODEL && selectedModel !== AUTO_THINKING_MODEL);

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

  const options = [
    {
      id: AUTO_FAST_MODEL,
      label: "Auto (Fast)",
      hint: "Prioritizes speed. Uses Mistral first, then falls back automatically.",
    },
    {
      id: AUTO_THINKING_MODEL,
      label: "Auto (Thinking)",
      hint: "Previous Auto behavior, tuned for better role accuracy and localization.",
    },
  ];

  const activeText = inLegacyManual
    ? "Legacy manual model"
    : (selectedModel === AUTO_THINKING_MODEL ? "Auto (Thinking)" : "Auto (Fast)");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm transition"
        title="Select generation mode"
      >
        <span className="text-sm font-semibold max-w-[210px] truncate">{activeText}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute z-[120] bottom-full mb-2 right-0 w-[360px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
          <div className="max-h-[300px] md:max-h-[320px] overflow-auto p-2">
            {options.map((row) => {
              const active = !inLegacyManual && selectedModel === row.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    onChange({ provider: "auto", model: String(row.id) });
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border mb-2 transition ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="text-sm font-semibold">{row.label}</div>
                  <div className={`text-[11px] ${active ? "text-white/80" : "text-slate-500"}`}>{row.hint}</div>
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
