import { GoogleGenAI } from "@google/genai";
import { DecisionState } from "../types";

// ---------------------------
// REQUIRED SCHEMA (for UI)
// ---------------------------
interface ParsedAnalysis {
  optionId: string;
  criteriaAnalysis: {
    criteriaId: string;
    score: number;
    reasoning: string;
  }[];
  pros: string[];
  cons: string[];
}

interface SherlockResult {
  analysis: ParsedAnalysis[];
  verdict: string;
  winnerId: string;
  recommendation: string;
}

// Helper: robustly extract text from various response shapes
async function extractRawText(response: any): Promise<string> {
  // 1) If response.text is a function, call it
  try {
    if (response && typeof response.text === "function") {
      const t = await response.text();
      if (typeof t === "string" && t.length) return t;
    }
  } catch (e) {
    // ignore and fallback
    console.warn("response.text() call failed:", e);
  }

  // 2) If response.text is a string property
  if (response && typeof response.text === "string" && response.text.length) {
    return response.text;
  }

  // 3) If response.outputText exists (some SDK variants)
  if (response && typeof (response as any).outputText === "string" && (response as any).outputText.length) {
    return (response as any).outputText;
  }

  // 4) If response.outputs is an array, try to find text or JSON inside
  if (response && Array.isArray((response as any).outputs)) {
    try {
      for (const out of (response as any).outputs) {
        if (!out) continue;
        // out.text
        if (typeof out.text === "string" && out.text.length) return out.text;
        // out.content array
        if (Array.isArray(out.content)) {
          for (const c of out.content) {
            if (!c) continue;
            if (typeof c.text === "string" && c.text.length) return c.text;
            if (c.mimeType === "application/json" && c.json) {
              try {
                return JSON.stringify(c.json);
              } catch (e) {
                // continue
              }
            }
            // sometimes content entries have "items" with text
            if (typeof c === "string" && c.length) return c;
          }
        }
      }
    } catch (e) {
      console.warn("Error while reading response.outputs:", e);
    }
  }

  // 5) Fallback: try to stringify response (trim)
  try {
    const s = JSON.stringify(response);
    if (s && s.length) return s;
  } catch (e) {
    // last resort
  }

  return String(response ?? "");
}

// ------------------------------------------------------
// MAIN FUNCTION
// ------------------------------------------------------
export const analyzeDecision = async (data: DecisionState): Promise<SherlockResult> => {
  console.log("Sherlock called with data:", data);

  if (!process.env.API_KEY) {
    throw new Error("API Key missing. Set process.env.API_KEY.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Build user context text
  let userText = `Decision Sherlock — Analyze the decision: "${data.title}"
Context: ${data.description || "No extra context."}

Criteria (1–10 weights):
`;

  data.criteria.forEach(c => {
    userText += `- ${c.id}: ${c.name} (Weight: ${c.weight})\n`;
  });

  userText += `\nOptions:\n`;
  data.options.forEach(opt => {
    userText += `\nOption ${opt.id} — ${opt.name}\n${opt.description || ""}\n`;
  });

  // ------------------------
  // BUILD CONTENTS
  // ------------------------
  const contents: any[] = [
    {
      role: "system",
      parts: [
        {
          text: `
You are Decision Sherlock — an analytical, objective decision engine.
You MUST produce JSON **only** in the exact required structure (no explanations outside JSON).

### OUTPUT RULES (MANDATORY) ###
1. Your final answer MUST begin with:  ###RESULT_JSON###
2. After that, output ONLY valid JSON.
3. JSON MUST match exactly:
{
  "analysis": [
    {
      "optionId": "...",
      "criteriaAnalysis": [
        { "criteriaId": "...", "score": 0-100, "reasoning": "..." }
      ],
      "pros": ["..."],
      "cons": ["..."]
    }
  ],
  "verdict": "...",
  "winnerId": "...",
  "recommendation": "..."
}
4. "analysis" MUST ALWAYS be an ARRAY.
5. Do NOT output markdown, code fences, or commentary.
6. No text after the JSON block.

Be concise, structured, and deterministic.
`
        }
      ]
    },

    // user content
    {
      role: "user",
      parts: [{ text: userText }]
    }
  ];

  // Attach files if present
  data.options.forEach(opt => {
    if (opt.attachments && opt.attachments.length > 0) {
      opt.attachments.forEach(att => {
        contents.push({
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: att.mimeType,
                data: att.data
              }
            },
            { text: `(Attachment for option ${opt.id}: ${att.name})` }
          ]
        });
      });
    }
  });

  // Final output instruction
  contents.push({
    role: "user",
    parts: [
      {
        text: `
Analyze all evidence. Score all criteria (0–100). Provide reasoning.
When finished, output ONLY JSON beginning with ###RESULT_JSON###.
`
      }
    ]
  });

  // ------------------------
  // CALL GEMINI
  // ------------------------
  let response: any;
  try {
    response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents,
      config: { temperature: 0.15, responseMimeType: "text/plain" }
    });
  } catch (err) {
    console.error("Gemini API ERROR:", err);
    throw err;
  }

  // Robustly extract raw text from response
  const rawText = await extractRawText(response);
  console.log("RAW MODEL OUTPUT (first 4000 chars):", rawText ? rawText.slice(0, 4000) : rawText);

  // ------------------------
  // EXTRACT JSON
  // ------------------------
  const marker = "###RESULT_JSON###";
  const pos = rawText.indexOf(marker);
  if (pos === -1) {
    // if marker missing, try to find first JSON object in rawText as fallback
    const fallbackMatch = rawText.match(/(\{[\s\S]*\})/m);
    if (!fallbackMatch) {
      console.error("Model output did not contain ###RESULT_JSON### and no JSON object found. Raw output:", rawText.slice(0, 2000));
      throw new Error("Model did NOT output ###RESULT_JSON###. Fix prompt or inspect raw output (see console).");
    }
  }

  // take substring after marker if marker present, else use fallback first JSON
  let jsonText: string;
  if (pos !== -1) {
    jsonText = rawText.substring(pos + marker.length).trim();
  } else {
    const fallbackMatch = rawText.match(/(\{[\s\S]*\})/m);
    jsonText = fallbackMatch ? fallbackMatch[1] : "";
  }

  // Remove common fences if model added them
  const cleaned = jsonText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  console.log("CLEANED JSON (first 4000 chars):", cleaned ? cleaned.slice(0, 4000) : cleaned);

  let parsed: SherlockResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("JSON PARSE ERROR. Cleaned block (first 2000 chars):", cleaned.slice(0, 2000));
    throw new Error("AI returned invalid JSON. See console logs for raw output and cleaned JSON.");
  }

  // Safety: ensure analysis is always an array
  if (!Array.isArray(parsed.analysis)) {
    console.warn("Parsed result.analysis is not an array — normalizing to an empty array and preserving winner/verdict if present.");
    parsed.analysis = [];
  }

  console.log("Sherlock parsed JSON:", parsed);
  return parsed;
};
