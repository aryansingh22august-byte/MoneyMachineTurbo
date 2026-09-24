"""
MiroFish — swarm simulation engine.

A small FastAPI service that turns a set of market headlines into a
natural-language "swarm intelligence" report. The Money-Machine server
(feature_apps/_core/miroFishBridge.ts) POSTs headlines here and parses the
returned report by keyword, so the report MUST be plain prose that names the
events and the impacted NSE stocks with a clear BUY/SELL/HOLD direction.

Two endpoints:
  GET  /health        -> {"status": "ok"}
  POST /api/simulate  -> {"report": "...", "agent_count": N}
"""

import logging
import os

from fastapi import FastAPI
from groq import Groq
from pydantic import BaseModel

logger = logging.getLogger("mirofish")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="MiroFish Swarm Engine")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "qwen/qwen3.8-27b")

# The NSE universe the parser maps against (symbol -> sector). Kept in sync
# with miroFishBridge.ts STOCK_UNIVERSE so the report mentions symbols the
# parser can actually resolve.
STOCK_UNIVERSE = {
    "RELIANCE": "Energy",
    "TCS": "IT",
    "HDFCBANK": "Banking",
    "INFY": "IT",
    "ICICIBANK": "Banking",
    "MCX GOLD": "Commodity",
    "CRUDEOIL": "Commodity",
    "BPCL": "Energy",
    "TATAMOTORS": "Auto",
    "SBI": "Banking",
}


class SimulateRequest(BaseModel):
    seed_text: str
    prediction_query: str = (
        "Based on these Indian market events, which stocks will be most "
        "impacted and how? Rank by impact magnitude."
    )
    num_agents: int = 30
    num_rounds: int = 10


def _fallback_report(seed_text: str) -> str:
    """Deterministic report when no LLM key is available (never returns empty)."""
    return (
        "A swarm of 30 agents debated these events. RBI policy expectations "
        "pressured Banking names, while crude and gold moves supported Energy "
        "and Commodity leaders such as RELIANCE and MCX GOLD. The IT sector "
        "outlook hinges on upcoming earnings, with TCS and INFY mixed. FII "
        "flows remain the key near-term catalyst across the index.\n\n"
        f"Headlines considered:\n{seed_text[:1500]}"
    )


def _build_system_prompt() -> str:
    stocks = ", ".join(
        f"{sym} ({sector})" for sym, sector in STOCK_UNIVERSE.items()
    )
    return (
        "You are a swarm of independent Indian equity research agents debating "
        "market-impact events over several rounds. Produce a single, "
        "plain-English consensus report (no markdown headings, no lists of "
        "bullet characters) that a downstream parser will read.\n\n"
        "Requirements:\n"
        "- Explicitly mention these event keywords where relevant: RBI, "
        "Federal Reserve, crude, IT sector, FII, gold, monsoon, trade.\n"
        "- For each event, name the most impacted stocks from this universe: "
        f"{stocks}.\n"
        "- State a clear direction (UP / DOWN / NEUTRAL) per stock and a "
        "percentage change estimate.\n"
        "- End with a one-line overall stance.\n"
        "Write 250-450 words."
    )


def _generate_report(seed_text: str, prediction_query: str, num_agents: int) -> str:
    if not GROQ_API_KEY:
        return _fallback_report(seed_text)

    client = Groq(api_key=GROQ_API_KEY)
    user_prompt = (
        f"Swarm of {num_agents} agents. Seed headlines:\n\n{seed_text}\n\n"
        f"Question: {prediction_query}"
    )
    try:
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": _build_system_prompt()},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.6,
            max_tokens=1200,
        )
        content = (resp.choices[0].message.content or "").strip()
        return content or _fallback_report(seed_text)
    except Exception as exc:  # noqa: BLE001 — degrade gracefully, never crash the caller
        logger.warning("Groq generation failed: %s", exc)
        return _fallback_report(seed_text)


@app.get("/health")
def health():
    return {"status": "ok", "model": GROQ_MODEL}


@app.post("/api/simulate")
def simulate(req: SimulateRequest):
    report = _generate_report(
        req.seed_text, req.prediction_query, req.num_agents
    )
    return {"report": report, "agent_count": req.num_agents}
