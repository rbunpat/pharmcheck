"use client";

import { useState } from "react";

interface ScanResponse {
  decision?: string;
  flags?: string[];
  message?: { altText?: string; contents?: Record<string, unknown> };
  error?: string;
}

const TEST_ALLERGIES = [
  "เพนิซิลลิน",
  "ซัลโฟนาไมด์",
  "NSAIDs / แอสไพริน",
  "พาราเซตามอล",
];

export default function TestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("image", file);
      for (const a of selected) form.append("allergy", a);
      const res = await fetch("/api/scan", { method: "POST", body: form });
      setResult((await res.json()) as ScanResponse);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-5 bg-zinc-50 p-6 font-sans">
      <h1 className="text-2xl font-bold text-zinc-900">PharmCheck — ทดสอบระบบ</h1>
      <p className="text-sm text-zinc-600">
        อัปโหลดรูปบรรจุภัณฑ์ยาเพื่อทดสอบ pipeline: OCR → ค้นหาทะเบียน อย. → ตรวจสอบการแพ้
      </p>

      <input
        type="file"
        accept="image/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-full file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-white"
      />

      <div>
        <p className="mb-2 text-sm font-medium text-zinc-700">
          จำลองข้อมูลการแพ้ (สำหรับทดสอบ)
        </p>
        <div className="flex flex-wrap gap-2">
          {TEST_ALLERGIES.map((a) => (
            <button
              key={a}
              onClick={() => toggle(a)}
              className={`rounded-full border px-3 py-1 text-sm ${
                selected.has(a)
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-zinc-300 bg-white text-zinc-700"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={submit}
        disabled={!file || loading}
        className="h-12 rounded-full bg-emerald-600 font-semibold text-white disabled:opacity-50"
      >
        {loading ? "กำลังตรวจสอบ…" : "ตรวจสอบยา"}
      </button>

      {result && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          {result.error ? (
            <p className="text-red-600">ข้อผิดพลาด: {result.error}</p>
          ) : (
            <>
              <p className="mb-2 text-sm">
                <span className="font-semibold">Decision:</span>{" "}
                <span
                  className={
                    result.decision === "INFO"
                      ? "text-emerald-700"
                      : result.decision === "REFER"
                        ? "text-red-700"
                        : "text-amber-700"
                  }
                >
                  {result.decision}
                </span>
              </p>
              <p className="mb-3 text-sm">
                <span className="font-semibold">Flags:</span>{" "}
                {result.flags?.length ? result.flags.join(", ") : "—"}
              </p>
              <p className="mb-1 text-sm font-semibold">Flex message preview:</p>
              <pre className="max-h-96 overflow-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100">
                {JSON.stringify(result.message, null, 2)}
              </pre>
            </>
          )}
        </section>
      )}

      <p className="text-center text-xs text-zinc-400">
        ข้อมูลนี้ไม่ใช่คำแนะนำทางการแพทย์
      </p>
    </main>
  );
}