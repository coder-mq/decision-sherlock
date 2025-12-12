// src/services/decisionSherlock.ts
/**
 * Decision Sherlock - service wrapper for calling Gemini / generative model
 * - Robust model call + response parsing
 * - Strict JSON prompt + example to encourage correct JSON output
 * - Normalization and fallback handling
 * - Templates, local save/share helpers
 *
 * IMPORTANT:
 * - Do NOT store API keys in client-side code for production. This file assumes
 *   it runs on a server or inside a trusted environment where process.env.API_KEY is safe.
 *
 * Usage:
 * import { analyzeDecision, saveCase, loadSavedCases, encodeStateToUrl, decodeStateFromUrl, sampleTemplates } from './services/decisionSherlock';
 *
 */

import { GoogleGenAI } from "@google/genai";
import { DecisionState, AnalysisResult, Criterion, OptionItem } from "../types";

/* -----------------------
   Types used in this file
   ----------------------- */
interface ParsedCriteriaAnalysis {
  criteriaId: string;
  score: number;
  reasoning: string;
  confidence?: number; // optional confidence from model
}

interface ParsedOptionAnalysis {
  optionId: string;
  criteriaAnalysis: ParsedCriteriaAnalysis[];
  pros: string[];
  cons: string[];
}

export interface SherlockResult {
  analysis: ParsedOptionAnalysis[]; // MUST be an array (guarded later)
  verdict: string;
  winnerId: string;
  recommendation: string;
  // optional additional fields the model may return:
  summary?: string;
  topRisks?: string[];
  nextSteps?: string[];
}

/* -----------------------
   Helpers
   ----------------------- */

/** Safely parse JSON with some cleaning heuristics (trailing commas etc.) */
function safeParseJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch (err) {
    // Try cleaning common issues (trailing commas)
    const cleaned = text.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // Last-resort: attempt to extract first {...} block
      const m = cleaned.match(/(\{[\s\S]*\})/m);
      if (m) {
        try {
          return JSON.parse(m[1]);
        } catch (er) {
          throw new Error("Safe parse failed: JSON invalid after cleaning.");
        }
      }
      throw new Error("Safe parse failed: Not valid JSON.");
    }
  }
}

/** Normalize numeric score into 0..100 */
function clampScore(n: any): number {
  const v = Number(n || 0);
  if (isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v);
}

/* -----------------------
   Prompt templates & examples
   ----------------------- */

/** Small set of example JSON the model should follow */
const EXAMPLE_JSON = {
  analysis: [
    {
      optionId: "o1",
      criteriaAnalysis: [
        { criteriaId: "c1", score: 88, reasoning: "Good rent vs size ratio" },
        { criteriaId: "c2", score: 70, reasoning: "Slightly farther from work" }
      ],
      pros: ["Great location", "Newly renovated"],
      cons: ["A bit small"]
    }
  ],
  verdict: "Option 1 is preferred because ...",
  winnerId: "o1",
  recommendation: "Take Option 1 and renegotiate the lease"
};

/** A stronger prompt block that instructs the model to output JSON only and gives an example */
function createSystemPrompt(): string {
  return `
You are Decision Sherlock — a strictly structured multimodal decision analyst.
Follow these rules exactly:

1) Output ONLY one JSON object that matches the schema shown below. Start with the exact marker: ###RESULT_JSON### (on its own line).
2) Do NOT include any markdown, code fences, or additional text outside the JSON block.
3) JSON schema:
   {
     "analysis": [
       {
         "optionId": "...",
         "criteriaAnalysis": [
           { "criteriaId": "...", "score": 0-100, "reasoning": "..." , "confidence": optional_number }
         ],
         "pros": ["..."],
         "cons": ["..."]
       }
     ],
     "verdict": "...",
     "winnerId": "...",
     "recommendation": "..."
   }
4) "analysis" MUST be an array. Each option MUST have optionId, criteriaAnalysis, pros, cons.
5) If you reference attachments (images/pdf), extract short facts from them and use them in scoring/reasoning.
6) Provide numeric scores between 0 and 100 for each criteria and short reasoning for each score.
7) You may optionally include a confidence value (0-100) for each criteria score.
8) Be concise and objective.

Example JSON output (for reference):
${JSON.stringify(EXAMPLE_JSON, null, 2)}

Remember: Output must begin with the line "###RESULT_JSON###" followed immediately by the JSON object.
`;
}

/** Build the user prompt (context) including the criteria list and options; include attachments notes separately. */
function buildUserPrompt(data: DecisionState): string {
  const lines: string[] = [];
  lines.push(`Decision: ${data.title || "Untitled decision"}`);
  lines.push(`Context: ${data.description || "No additional context provided."}`);
  lines.push("");
  lines.push("Criteria (ID | Name | Weight 1-10):");
  data.criteria.forEach((c: Criterion) => {
    lines.push(`- ${c.id} | ${c.name} | ${c.weight}`);
  });
  lines.push("");
  lines.push("Options:");
  data.options.forEach((opt: OptionItem) => {
    lines.push(`--- Option ID: ${opt.id} ---`);
    lines.push(`Name: ${opt.name}`);
    lines.push(`Description: ${opt.description || ""}`);
    if (opt.attachments && opt.attachments.length) {
      for (const att of opt.attachments) {
        lines.push(`(Attachment: ${att.name || "file"}, type: ${att.mimeType})`);
      }
    }
    lines.push("");
  });

  lines.push(
    "Task: Score each option against each criteria (0-100). Provide short reasoning for each score. Return only the JSON as described in the system instructions above (prefix with ###RESULT_JSON###)."
  );

  return lines.join("\n");
}

/* -----------------------
   Local save + share helpers
   ----------------------- */

const STORAGE_KEY = "decision-sherlock-saved-cases";

/** Save a case summary to localStorage */
export function saveCase(caseName: string, state: DecisionState) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const entry = {
      id: `case_${Date.now()}`,
      name: caseName || state.title || `Case ${new Date().toISOString()}`,
      state,
      createdAt: new Date().toISOString()
    };
    saved.unshift(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return entry;
  } catch (err) {
    console.error("Failed to save case:", err);
    throw err;
  }
}

/** Load saved cases from localStorage */
export function loadSavedCases(): any[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch (err) {
    return [];
  }
}

/** Encode decision state into URL-safe string (for share link) */
export function encodeStateToUrl(state: DecisionState): string {
  const payload = encodeURIComponent(btoa(JSON.stringify(state)));
  // Example return: ?share=...
  return `${window.location.origin}${window.location.pathname}?share=${payload}`;
}

/** Decode state from URL share token */
export function decodeStateFromUrl(token?: string): DecisionState | null {
  try {
    const raw = token ?? new URLSearchParams(window.location.search).get("share") ?? "";
    if (!raw) return null;
    const json = atob(decodeURIComponent(raw));
    return JSON.parse(json) as DecisionState;
  } catch (err) {
    console.error("Failed to decode shared state:", err);
    return null;
  }
}

/* -----------------------
   Primary analyzeDecision function
   ----------------------- */

/**
 * analyzeDecision
 * - data: DecisionState (criteria, options, attachments)
 * - returns: SherlockResult (normalized)
 *
 * This function is intentionally defensive: it attempts to parse several shapes of model responses,
 * extracts a JSON block prefixed by ###RESULT_JSON### (recommended), and normalizes the result.
 */
export const analyzeDecision = async (data: DecisionState): Promise<SherlockResult> => {
  console.debug("Sherlock called with data:", data);

  if (!process.env.API_KEY) {
    // For developer convenience: allow fallback to window.__API_KEY__ if running in browser dev environment.
    const fallback = (globalThis as any).__API_KEY__;
    if (!fallback) {
      throw new Error("Missing API key. Set process.env.API_KEY on server or window.__API_KEY__ for local dev.");
    } else {
      (process as any).env = { ...(process as any).env, API_KEY: fallback };
    }
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Build messages/contents per the SDK expectations.
  const systemMsg = createSystemPrompt();
  const userMsg = buildUserPrompt(data);

  // contents structure: use "parts" arrays for compatibility with the earlier examples
  const contents: any[] = [
    {
      role: "system",
      parts: [{ text: systemMsg }]
    },
    {
      role: "user",
      parts: [{ text: userMsg }]
    }
  ];

  // Attach actual inlineData objects for each attachment (if present)
  data.options.forEach((opt) => {
    if (opt.attachments && opt.attachments.length) {
      opt.attachments.forEach(att => {
        // att.data MUST be base64 (without data:... prefix)
        contents.push({
          role: "user",
          parts: [
            { inlineData: { mimeType: att.mimeType, data: att.data, name: att.name || "attachment" } },
            { text: `(Attachment for option ${opt.id}: ${att.name || "attachment"})` }
          ]
        });
      });
    }
  });

  // Final instruction as user message (explicit)
  contents.push({
    role: "user",
    parts: [
      {
        text:
          "Analyze all evidence and score each option (0-100) for each criterion. Provide short reasoning per score. Return exactly ONE JSON object prefixed by the line ###RESULT_JSON### with the structure in the system message. No other text."
      }
    ]
  });

  // Call the model (defensive: handle different response shapes)
  let response: any;
  try {
    response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents,
      config: {
        temperature: 0.15,
        // Ask for plain text; some SDKs return object shapes
        responseMimeType: "text/plain"
      }
    });
  } catch (err: any) {
    console.error("Gemini API ERROR:", err);
    throw err;
  }

  // Extract textual output robustly:
  // - if response.value or response.output exists, try those
  // - if response.text is a function (stream-like), await it
  // - if response.text is a string, use it
  let rawText = "";
  try {
    if ((response as any).value) {
      rawText = JSON.stringify((response as any).value);
    } else if ((response as any).text && typeof (response as any).text === "function") {
      rawText = await (response as any).text();
    } else if (typeof (response as any).text === "string") {
      rawText = (response as any).text;
    } else if ((response as any).outputs && Array.isArray((response as any).outputs)) {
      // some SDKs use outputs array
      rawText = (response as any).outputs.map((o: any) => (o?.text ?? JSON.stringify(o))).join("\n");
    } else {
      rawText = JSON.stringify(response);
    }
  } catch (err) {
    console.error("Failed to extract text from model response:", err, response);
    throw new Error("Failed to extract model text.");
  }

  console.debug("RAW MODEL OUTPUT (first 2000 chars):", rawText.slice(0, 2000));

  // Try to detect the ###RESULT_JSON### marker first (recommended)
  const marker = "###RESULT_JSON###";
  let jsonCandidate: string | null = null;

  const markerIndex = rawText.indexOf(marker);
  if (markerIndex !== -1) {
    // take the substring after the marker
    jsonCandidate = rawText.substring(markerIndex + marker.length).trim();
    // strip common fences/backticks if model added them
    jsonCandidate = jsonCandidate.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  } else {
    // fallback: try to extract the first {...} JSON object block
    const m = rawText.match(/(\{[\s\S]*\})/m);
    if (m) jsonCandidate = m[1];
  }

  if (!jsonCandidate) {
    console.error("Could not find JSON block in model output. Raw output:", rawText.slice(0, 2000));
    throw new Error("Model did not return extractable JSON. See console for raw output.");
  }

  // Clean and parse
  let parsedRaw: any;
  try {
    parsedRaw = safeParseJSON(jsonCandidate);
  } catch (err) {
    console.error("Failed to parse JSON candidate. Candidate (first 2000):", jsonCandidate.slice(0, 2000));
    throw new Error("AI returned invalid JSON. See console.");
  }

  // Basic normalization / backwards compatibility:
  // A) The model may return analysis as object or have slightly different field names.
  // B) Ensure analysis is an array of objects with expected fields.
  const ensureAnalysisArray = (candidate: any): any[] => {
    if (!candidate) return [];
    if (Array.isArray(candidate)) return candidate;
    // If it's an object containing 'analysis' key
    if (candidate.analysis && Array.isArray(candidate.analysis)) return candidate.analysis;
    // If the root itself looks like the full result, try to wrap it
    if (candidate.optionId && candidate.criteriaAnalysis) return [candidate];
    return [];
  };

  const rawAnalysis = ensureAnalysisArray(parsedRaw.analysis ?? parsedRaw.analysis ?? parsedRaw);

  // Build normalized final result
  const final: SherlockResult = {
    analysis: [],
    verdict: parsedRaw.verdict ?? parsedRaw.summary ?? parsedRaw.verdict_text ?? "",
    winnerId: parsedRaw.winnerId ?? parsedRaw.winner_id ?? parsedRaw.winner ?? "",
    recommendation: parsedRaw.recommendation ?? parsedRaw.advice ?? "",
    summary: parsedRaw.summary ?? undefined,
    topRisks: parsedRaw.topRisks ?? parsedRaw.risks ?? undefined,
    nextSteps: parsedRaw.nextSteps ?? parsedRaw.actions ?? undefined
  };

  // Normalize each option analysis
  final.analysis = rawAnalysis.map((a: any) => {
    // Some models may use different field names; test multiple possibilities
    const optId = a.optionId ?? a.option_id ?? a.opt_id ?? a.id ?? "unknown";

    // criteriaAnalysis can be in various shapes — normalize to array
    const rawCA = a.criteriaAnalysis ?? a.criteria_analysis ?? a.criteria ?? [];

    const caArray = Array.isArray(rawCA) ? rawCA : [];

    const normalizedCA = caArray.map((ca: any) => ({
      criteriaId: ca.criteriaId ?? ca.criteria_id ?? ca.criterionId ?? ca.id ?? "",
      score: clampScore(ca.score ?? ca.sc ?? ca.value ?? ca),
      reasoning: String(ca.reasoning ?? ca.reason ?? ca.notes ?? ""),
      confidence: ca.confidence !== undefined ? clampScore(ca.confidence) : undefined
    })) as ParsedCriteriaAnalysis[];

    const pros: string[] = Array.isArray(a.pros) ? a.pros.map(String) : Array.isArray(a.positives) ? a.positives.map(String) : [];
    const cons: string[] = Array.isArray(a.cons) ? a.cons.map(String) : Array.isArray(a.negatives) ? a.negatives.map(String) : [];

    return {
      optionId: String(optId),
      criteriaAnalysis: normalizedCA,
      pros,
      cons
    } as ParsedOptionAnalysis;
  });

  // As a guard, ensure analysis is an array (empty if none)
  if (!Array.isArray(final.analysis)) final.analysis = [];

  // Ensure each criteriaAnalysis has numeric scores and optional confidence normalized
  final.analysis.forEach((opt) => {
    opt.criteriaAnalysis = (opt.criteriaAnalysis || []).map((ca) => ({
      criteriaId: ca.criteriaId ?? "",
      score: clampScore(ca.score),
      reasoning: ca.reasoning ?? "",
      confidence: ca.confidence !== undefined ? clampScore(ca.confidence) : undefined
    }));
  });

  console.debug("Parsed Sherlock result:", final);

  // Final validation: ensure winnerId exists in analysis; if not, attempt to derive highest weighted score (best-effort)
  if (!final.winnerId && final.analysis.length > 1) {
    // choose option with highest average score
    const candidate = final.analysis
      .map((opt) => {
        const avg = opt.criteriaAnalysis.length ? opt.criteriaAnalysis.reduce((s, c) => s + c.score, 0) / opt.criteriaAnalysis.length : 0;
        return { optionId: opt.optionId, avg };
      })
      .sort((a, b) => b.avg - a.avg)[0];
    if (candidate) final.winnerId = candidate.optionId;
  }

  // Done
  return final;
};

/* -----------------------
   Convenience templates for UI
   ----------------------- */

export const sampleTemplates = {
  jobOffers: {
    title: "Job Offer A vs Job Offer B",
    description: "Compare two job offers for salary, growth, commute and culture.",
    criteria: [
      { id: "salary", name: "Salary", weight: 9 },
      { id: "growth", name: "Career Growth", weight: 7 },
      { id: "commute", name: "Commute", weight: 6 },
      { id: "culture", name: "Culture", weight: 6 }
    ]
  },
  realEstate: {
    title: "Apartment A vs Apartment B",
    description: "Compare two rental apartments for rent, size, location and amenities.",
    criteria: [
      { id: "rent", name: "Rent", weight: 9 },
      { id: "location", name: "Location", weight: 8 },
      { id: "size", name: "Size", weight: 6 },
      { id: "amenities", name: "Amenities", weight: 5 }
    ]
  },
  travel: {
    title: "Trip Option A vs Trip Option B",
    description: "Compare two travel plans based on cost, convenience, experience and duration.",
    criteria: [
      { id: "cost", name: "Cost", weight: 8 },
      { id: "experience", name: "Experience", weight: 7 },
      { id: "time", name: "Time/Dur", weight: 6 },
      { id: "convenience", name: "Convenience", weight: 5 }
    ]
  },
  gadgets: {
    title: "Phone A vs Phone B",
    description: "Compare two smartphones for price, battery, camera, and ecosystem.",
    criteria: [
      { id: "price", name: "Price", weight: 8 },
      { id: "battery", name: "Battery", weight: 7 },
      { id: "camera", name: "Camera", weight: 7 },
      { id: "ecosystem", name: "Ecosystem", weight: 5 }
    ]
  }
};

/* -----------------------
   Exported convenience functions
   ----------------------- */

/** Build a shareable URL from state and put it in the clipboard (returns the url) */
export async function copyShareUrlToClipboard(state: DecisionState): Promise<string> {
  const url = encodeStateToUrl(state);
  try {
    await navigator.clipboard.writeText(url);
  } catch (e) {
    // fallback: return url for manual copying
    console.warn("Clipboard write failed, returning URL for manual copy.");
  }
  return url;
}
