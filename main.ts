import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const ACTION_API_KEY = Deno.env.get("ACTION_API_KEY")!;
const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/health") return json({ ok: true });

  if (url.pathname !== "/transcribe" || req.method !== "POST") {
    return json({ error: "Not found" }, 404);
  }

  const apiKey = req.headers.get("x-api-key");
  if (!apiKey || apiKey !== ACTION_API_KEY) return json({ error: "Unauthorized" }, 401);

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ error: "Expected multipart/form-data" }, 400);
  }

  const form = await req.formData();
  const file = form.get("file");
  const language = (form.get("language") as string | null) ?? null;
  const diarize = (form.get("diarize") as string | null) ?? "true";

  if (!(file instanceof File)) return json({ error: "Missing file" }, 400);

  const model = diarize === "true" ? "gpt-4o-transcribe-diarize" : "gpt-4o-transcribe";

  const openaiForm = new FormData();
  openaiForm.set("model", model);
  if (language) openaiForm.set("language", language);
  if (diarize === "true") {
    openaiForm.set("response_format", "diarized_json");
    openaiForm.set("chunking", "auto");
  }
  openaiForm.set("file", file, file.name);

  const r = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: openaiForm,
  });

  if (!r.ok) {
    const text = await r.text();
    return json({ error: "OpenAI error", status: r.status, detail: text }, 500);
  }

  const payload = await r.json();

  const out = {
    text: payload?.text ?? "",
    duration: payload?.duration ?? null,
    segments: Array.isArray(payload?.segments)
      ? payload.segments.map((s: any) => ({
          speaker: String(s?.speaker ?? "unknown"),
          start: Number(s?.start ?? 0),
          end: Number(s?.end ?? 0),
          text: String(s?.text ?? ""),
        }))
      : [],
  };

  return json(out);
});
