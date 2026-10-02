"""Persistent exploration state for DevTrail autonomous discovery."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def fingerprint_dom(dom: list[dict[str, Any]]) -> str:
    """Return a stable fingerprint for the observable interactive DOM."""
    normalized = [
        {
            "tag": item.get("tag"),
            "id": item.get("id"),
            "name": item.get("name"),
            "role": item.get("role"),
            "text": item.get("text"),
            "type": item.get("type"),
            "disabled": item.get("disabled"),
            "href": item.get("href"),
            "selector": item.get("selector"),
        }
        for item in dom
    ]
    return hashlib.sha256(_stable_json(normalized).encode("utf-8")).hexdigest()[:16]


def action_key(action: dict[str, Any]) -> str:
    """Identify an action independently of its execution result."""
    payload = {
        "type": action.get("type"),
        "selector": action.get("selector"),
        "input_type": action.get("input_type"),
        "description": action.get("description"),
    }
    return hashlib.sha256(_stable_json(payload).encode("utf-8")).hexdigest()[:16]


def empty_state(target: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": 1,
        "target": {
            "title": target.get("title"),
            "url": target.get("url"),
        },
        "states": {},
        "actions": {},
    }


def load_state(path: Path, target: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return empty_state(target)
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return empty_state(target)
    if state.get("version") != 1:
        return empty_state(target)
    return state


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def register_state(state: dict[str, Any], dom: list[dict[str, Any]]) -> str:
    """Register an observed DOM state and return its stable identifier."""
    state_id = fingerprint_dom(dom)
    state["states"][state_id] = {
        "dom_count": len(dom),
        "observations": state["states"].get(state_id, {}).get("observations", 0) + 1,
    }
    return state_id


def record_observation(
    state: dict[str, Any],
    dom: list[dict[str, Any]],
    action: dict[str, Any] | None,
    result: dict[str, Any] | None,
) -> tuple[str, str | None]:
    state_id = register_state(state, dom)

    if not action:
        return state_id, None

    key = action_key(action)
    entry = state["actions"].setdefault(
        key,
        {
            "type": action.get("type"),
            "selector": action.get("selector"),
            "description": action.get("description"),
            "attempts": 0,
            "results": [],
            "from_state": state_id,
        },
    )
    entry["attempts"] += 1
    entry["results"].append(
        {
            "ok": result.get("ok") if result else None,
            "tag": result.get("tag") if result else None,
            "error": result.get("error") if result else None,
        }
    )
    return state_id, key


def should_explore(state: dict[str, Any], action: dict[str, Any]) -> bool:
    """Return False when this exact action has already been explored."""
    return action_key(action) not in state.get("actions", {})
