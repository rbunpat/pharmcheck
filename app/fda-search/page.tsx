"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface FdaDrug {
  registrationNo: string;
  nameTh: string | null;
  nameEn: string | null;
  status: string | null;
  manufacturer: string | null;
}

interface SearchResponse {
  query?: string;
  mode?: string;
  total?: number;
  count?: number;
  drugs?: FdaDrug[];
  error?: string;
}

type Mode = "auto" | "regno" | "name";

const MODE_LABELS: Record<Mode, string> = {
  auto: "อัตโนมัติ",
  regno: "เลขทะเบียน",
  name: "ชื่อยา",
};

function statusColor(status: string | null): string {
  if (!status) return "text-zinc-500";
  if (status.includes("ยกเลิก")) return "text-red-600";
  if (status.includes("ระงับ")) return "text-amber-600";
  return "text-emerald-700";
}

export default function FdaSearchPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [drugs, setDrugs] = useState<FdaDrug[] | null>(null);
  const [meta, setMeta] = useState<{ mode: string; total: number; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (q: string, m: Mode) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/fda/search?q=${encodeURIComponent(trimmed)}&mode=${m}`,
          { signal: controller.signal },
        );
        const data = (await res.json()) as SearchResponse;
        if (data.error) {
          setError(data.error);
          setDrugs(null);
          setMeta(null);
        } else {
          setDrugs(data.drugs ?? []);
          setMeta({
            mode: data.mode ?? m,
            total: data.total ?? 0,
            count: data.count ?? 0,
          });
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : String(err));
          setDrugs(null);
          setMeta(null);
        }
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void search(query, mode);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-5 bg-zinc-50 p-6 font-sans">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900">ค้นหาทะเบียน อย.</h1>
        <p className="text-sm text-zinc-600">
          ค้นหาข้อมูลยาจากฐานข้อมูล อย. (FDA) — ระบุเลขทะเบียน เช่น{" "}
          <code className="rounded bg-zinc-200 px-1">1F 3/55(B)</code> หรือชื่อยา
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="เลขทะเบียน หรือ ชื่อยา…"
            className="h-11 flex-1 rounded-full border border-zinc-300 bg-white px-4 text-sm text-zinc-900 outline-none focus:border-emerald-600"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="h-11 rounded-full bg-emerald-600 px-5 font-semibold text-white disabled:opacity-50"
          >
            {loading ? "…" : "ค้นหา"}
          </button>
        </div>
        <div className="flex gap-2">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full border px-3 py-1 text-sm ${
                mode === m
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-zinc-300 bg-white text-zinc-700"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ข้อผิดพลาด: {error}
        </p>
      )}

      {meta && drugs && (
        <p className="text-sm text-zinc-600">
          พบ {meta.total} รายการ{meta.total > meta.count && ` (แสดง ${meta.count})`} · โหมด{" "}
          {MODE_LABELS[meta.mode as Mode] ?? meta.mode}
        </p>
      )}

      {drugs?.length === 0 && !error && (
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          ไม่พบข้อมูล — ลองเพิ่มช่องว่างหลังตัวอักษรนำหน้า (เช่น{" "}
          <code className="rounded bg-zinc-100 px-1">2C 207/28</code>) หรือค้นหาด้วยชื่อยาแทน
        </p>
      )}

      <div className="flex flex-col gap-3">
        {drugs?.map((d, i) => (
          <article
            key={`${d.registrationNo}-${i}`}
            className="rounded-xl border border-zinc-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold text-zinc-900">
                {d.nameTh ?? d.nameEn ?? d.registrationNo}
              </h2>
              <span className={`shrink-0 text-xs font-medium ${statusColor(d.status)}`}>
                {d.status ?? "—"}
              </span>
            </div>
            {d.nameTh && d.nameEn && (
              <p className="text-sm text-zinc-600">{d.nameEn}</p>
            )}
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-zinc-500">เลขทะเบียน</dt>
              <dd className="font-mono text-zinc-900">{d.registrationNo}</dd>
              <dt className="text-zinc-500">ผู้ผลิต</dt>
              <dd className="text-zinc-900">{d.manufacturer ?? "—"}</dd>
            </dl>
          </article>
        ))}
      </div>
    </main>
  );
}
