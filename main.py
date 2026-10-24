import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from openai import OpenAI, RateLimitError
from pydantic import BaseModel, Field

# Load OPEN_ROUTER_API_KEY (etc.) from a .env file in the project root if present.
load_dotenv()

app = FastAPI(title="Fit Flow")

# Allow the React dev server (and same-origin production) to call the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows requests from your frontend service
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OpenRouter exposes an OpenAI-compatible API.
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_MODEL = os.environ.get(
    "OPENROUTER_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free"
)

_client = None


def get_client() -> OpenAI:
    """Create the OpenRouter client on first use so the app can boot without a key.

    The key is only required when a workout is actually generated.
    """
    global _client
    if _client is None:
        api_key = os.environ.get("OPEN_ROUTER_API_KEY")
        if not api_key:
            raise RuntimeError(
                "OPEN_ROUTER_API_KEY is not set. Add it to your environment "
                "(see .env.example)."
            )
        _client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)
    return _client


logger = logging.getLogger("fit_flow")

# How many total attempts to make before giving up on a rate-limited request.
MAX_ATTEMPTS = 4


def _retry_delay_seconds(exc: RateLimitError, attempt: int) -> float:
    """Honor the API's retry-after header if present, else exponential backoff."""
    headers = getattr(getattr(exc, "response", None), "headers", None)
    if headers is not None:
        for key, is_ms in (("retry-after", False), ("retry-after-ms", True)):
            raw = headers.get(key)
            if not raw:
                continue
            try:
                value = float(raw)
            except (TypeError, ValueError):
                continue
            seconds = (value / 1000.0) if is_ms else value
            return max(0.5, min(seconds, 60.0))
    return float(min(2 ** attempt, 30))


def _generate_completion(prompt: str) -> str:
    """Call the model, retrying with backoff on rate limits (HTTP 429).

    Model-agnostic: uses whatever OPENROUTER_MODEL is configured, so it keeps
    working when the model is changed.
    """
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            completion = get_client().chat.completions.create(
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                # The language model which will generate the completion.
                model=OPENROUTER_MODEL,
            )
            return completion.choices[0].message.content or ""
        except RateLimitError as exc:
            if attempt >= MAX_ATTEMPTS:
                break
            delay = _retry_delay_seconds(exc, attempt)
            logger.warning(
                "Rate limited (attempt %d/%d); retrying in %.1fs",
                attempt,
                MAX_ATTEMPTS,
                delay,
            )
            time.sleep(delay)
    # Retries exhausted — surface it as a throttle, not a generic 502.
    raise HTTPException(
        status_code=429,
        detail=(
            "Rate limit reached. Please wait a moment and try again. "
            "A higher-tier model gives more headroom."
        ),
    )


TEMPLATE_PATH = Path(__file__).parent / "prompt_template.txt"

# Order matches the {placeholders} in prompt_template.txt.
TEMPLATE_VARS = (
    "workout_type",
    "duration",
    "difficulty",
    "equipment",
    "fitness_goal",
    "limitations",
)

# Single-pass replacement so a value that itself contains a placeholder token
# (or braces / quotes / newlines) can't be re-substituted by a later field.
_PLACEHOLDER_RE = re.compile("|".join(re.escape("{" + var + "}") for var in TEMPLATE_VARS))


def _fill_template(template: str, req: "WorkoutRequest") -> str:
    values = {var: getattr(req, var) for var in TEMPLATE_VARS}
    return _PLACEHOLDER_RE.sub(lambda m: values[m.group(0)[1:-1]], template)


class WorkoutRequest(BaseModel):
    # All optional and blank-tolerant, so empty or missing inputs don't 422.
    workout_type: str = Field("", examples=["Full body strength"])
    duration: str = Field("", examples=["30 minutes"])
    difficulty: str = Field("", examples=["Beginner"])
    equipment: str = Field("", examples=["Dumbbells, yoga mat"])
    fitness_goal: str = Field("", examples=["Build general strength"])
    limitations: str = Field("", examples=["Jumping, overhead pressing"])


def _clean_json(text: str) -> dict:
    """Parse the model's JSON, tolerating a ```json fence or stray prose.

    Falls back to extracting the outermost {...} block if the response isn't
    clean JSON (e.g. the model added a preamble or trailing commentary).
    """
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.startswith("json"):
            stripped = stripped[len("json"):].lstrip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        start, end = stripped.find("{"), stripped.rfind("}")
        if start != -1 and end > start:
            return json.loads(stripped[start : end + 1])
        raise


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/generate-workout")
def generate_workout(req: Optional[WorkoutRequest] = None):
    req = req or WorkoutRequest()
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    prompt = _fill_template(template, req)

    try:
        content = _generate_completion(prompt)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - surface any API failure to the client
        raise HTTPException(status_code=502, detail=f"OpenRouter API error: {exc}")

    try:
        data = _clean_json(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Model did not return parseable JSON: {content[:200]!r}",
        )
    return data


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
