"use client";

import { useCallback, useEffect, useState } from "react";
import liff from "@line/liff";

interface Allergy {
  id?: string;
  allergenName: string;
  keywords: string[];
  source: string;
}

interface Preset {
  name: string;
  keywords: string[];
}

export default function LiffProfilePage() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async (idToken: string) => {
    const res = await fetch("/api/profile", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");
    const data = (await res.json()) as { allergies: Allergy[]; presets: Preset[] };
    setPresets(data.presets);
    setSelected(new Set(data.allergies.map((a) => a.allergenName)));
  }, []);

  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) {
      const id = setTimeout(() => {
        setStatus("error");
        setError("NEXT_PUBLIC_LIFF_ID is not configured");
      }, 0);
      return () => clearTimeout(id);
    }
    liff
      .init({ liffId })
      .then(async () => {
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }
        await liff.ready;
        const idToken = await new Promise<string | null>((resolve) => {
          let attempts = 0;
          const tick = () => {
            const t = liff.getIDToken();
            if (t) return resolve(t);
            if (++attempts >= 10) return resolve(null);
            setTimeout(tick, 300);
          };
          tick();
        });
        if (!idToken) throw new Error("ไม่พบ access token");
        await load(idToken);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [load]);

  const toggle = (name: string) => {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const idToken = liff.getIDToken();
      if (!idToken) throw new Error("ไม่พบ ID token — กรุณาเข้าสู่ระบบใหม่");
      const allergens = [
        ...presets
          .filter((p) => selected.has(p.name))
          .map((p) => ({ name: p.name, keywords: p.keywords, source: "preset" })),
        ...(custom.trim()
          ? [{ name: custom.trim(), keywords: [custom.trim()], source: "custom" }]
          : []),
      ];
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ allergens }),
      });
      if (!res.ok) throw new Error("บันทึกไม่สำเร็จ");
      setSaved(true);
      setCustom("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return <main className="p-6 text-center text-zinc-600">กำลังโหลด…</main>;
  }
  if (status === "error") {
    return (
      <main className="p-6 text-center text-red-600">
        เกิดข้อผิดพลาด: {error}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 bg-white p-5 font-sans">
      <h1 className="text-xl font-bold text-zinc-900">ข้อมูลการแพ้ยา</h1>
      <p className="text-sm text-zinc-600">
        เลือกสารหรือยาที่แพ้ เพื่อให้ระบบเตือนเมื่อตรวจพบยาที่มีสารดังกล่าว
      </p>

      <div className="flex flex-col gap-2">
        {presets.map((p) => (
          <label
            key={p.name}
            className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 text-base text-zinc-900 has-checked:border-emerald-500 has-checked:bg-emerald-50"
          >
            <input
              type="checkbox"
              checked={selected.has(p.name)}
              onChange={() => toggle(p.name)}
              className="h-5 w-5 accent-emerald-600"
            />
            {p.name}
          </label>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          อื่น ๆ (ระบุเอง)
        </label>
        <input
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value);
            setSaved(false);
          }}
          placeholder="เ��่น ชื่อยาหรือสารที่แพ้"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-base"
        />
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="mt-2 h-12 rounded-full bg-emerald-600 text-base font-semibold text-white disabled:opacity-50"
      >
        {saving ? "กำลังบันทึก…" : "บันทึก"}
      </button>
      {saved && (
        <p className="text-center text-sm text-emerald-700">บันทึกเรียบร้อยแล้ว</p>
      )}
      <p className="mt-4 text-center text-xs text-zinc-400">
        ข้อมูลนี้ไม่ใช่คำแนะนำทางการแพทย์
      </p>
    </main>
  );
}