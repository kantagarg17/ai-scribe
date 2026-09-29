"""Turn a raw visit transcript into plain-language patient output.

Produces three things, matching the product mock:
  - a plain-language summary
  - clear next steps (action items)
  - a shareable caregiver update

The LLM is asked for strict JSON. We parse defensively and fall back to a
readable structure if the model doesn't cooperate.
"""
from __future__ import annotations

import json

from ..providers import get_llm_provider

_SYSTEM = (
    "You are AI-Scribe, a careful medical scribe writing for a patient with a "
    "6th-grade reading level. You turn a doctor visit transcript into clear, "
    "plain language. You never invent facts that are not in the transcript. "
    "You do not give new medical advice or diagnoses beyond what was said in "
    "the visit. If something is uncertain, say so plainly."
)

_INSTRUCTIONS = """\
Read the visit transcript below and produce a JSON object with exactly these keys:

- "summary": 3-6 short sentences in plain language explaining what happened at
  the visit and what it means for the patient. Define any medical term in
  parentheses the first time it appears.
- "next_steps": an array of short action-item strings the patient should do
  (appointments to book, medications, symptoms to watch for, who to call).
  Empty array if none were discussed.
- "caregiver_update": 2-4 sentences a patient could forward to a family member
  or caregiver, summarizing the visit and how they can help.

Return ONLY the JSON object, no prose before or after.

TRANSCRIPT:
{transcript}
"""


def _parse_json_object(text: str) -> dict:
    text = text.strip()
    # Strip common code-fence wrappers.
    if text.startswith("```"):
        text = text.split("```", 2)[1] if "```" in text[3:] else text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    # Grab the outermost {...} if there's surrounding prose.
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


def summarize_transcript(transcript: str) -> dict:
    """Return {"summary", "next_steps" (list), "caregiver_update"}."""
    llm = get_llm_provider()
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _INSTRUCTIONS.format(transcript=transcript.strip())},
    ]
    raw = llm.chat(messages, temperature=0.2)

    try:
        data = _parse_json_object(raw)
        summary = str(data.get("summary", "")).strip()
        steps = data.get("next_steps", [])
        if isinstance(steps, str):
            steps = [s.strip("-* ").strip() for s in steps.splitlines() if s.strip()]
        steps = [str(s).strip() for s in steps if str(s).strip()]
        caregiver = str(data.get("caregiver_update", "")).strip()
    except (json.JSONDecodeError, ValueError, TypeError):
        # Fallback: keep the model's text as the summary so nothing is lost.
        summary = raw.strip()
        steps = []
        caregiver = ""

    return {
        "summary": summary,
        "next_steps": steps,
        "caregiver_update": caregiver,
    }
