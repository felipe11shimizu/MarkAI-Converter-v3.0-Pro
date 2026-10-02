#!/usr/bin/env python3
"""Standalone DevTrail CDP runner without the Chrome extension."""

from __future__ import annotations
import argparse
import json
import os
import time
import urllib.request
from pathlib import Path
from typing import Any
import websocket

from devtrail.exploration_state import (
    action_key,
    load_state,
    record_observation,
    save_state,
    should_explore,
    register_state,
    record_transition,
)


DEFAULT_CDP_ENDPOINT = os.environ.get("DEVTRAIL_CDP_ENDPOINT", "http://127.0.0.1:9223")


def _get_json(endpoint: str, path: str) -> Any:
    with urllib.request.urlopen(endpoint.rstrip("/") + path, timeout=5) as response:
        return json.load(response)


def list_targets(endpoint: str = DEFAULT_CDP_ENDPOINT) -> list[dict[str, Any]]:
    """Return page targets from the legacy endpoint and Browser.getTargets fallback."""
    legacy = _get_json(endpoint, "/json/list")
    pages = [t for t in legacy if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
    if pages:
        return pages

    browser_ws_url = _get_json(endpoint, "/json/version").get("webSocketDebuggerUrl")
    if not browser_ws_url:
        return []

    client = CDPClient(browser_ws_url)
    client.connect()
    try:
        result = client.command("Target.getTargets")
        return [
            target
            for target in result.get("targetInfos", [])
            if target.get("type") == "page"
        ]
    finally:
        client.close()


def select_target(targets: list[dict[str, Any]], contains: str | None = None) -> dict[str, Any]:
    pages = [t for t in targets if t.get("type") == "page"]
    if contains:
        needle = contains.lower()
        pages = [t for t in pages if needle in (t.get("title", "") + " " + t.get("url", "")).lower()]
    if not pages:
        raise RuntimeError("Nenhuma aba Chrome compatível foi encontrada.")
    return pages[0]


class CDPClient:
    def __init__(self, ws_url: str, timeout: float = 10.0):
        self.ws_url = ws_url
        self.timeout = timeout
        self._id = 0
        self.session_id: str | None = None
        self.ws = None
        self.events: list[dict[str, Any]] = []

    def connect(self) -> None:
        self.ws = websocket.create_connection(self.ws_url, timeout=self.timeout)

    def close(self) -> None:
        if self.ws:
            self.ws.close()

    def command(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._id += 1
        request_id = self._id
        message: dict[str, Any] = {
            "id": request_id,
            "method": method,
            "params": params or {},
        }
        if self.session_id:
            message["sessionId"] = self.session_id
        self.ws.send(json.dumps(message))
        while True:
            response = json.loads(self.ws.recv())
            if response.get("method", "").startswith("Network."):
                self.events.append({
                    "method": response["method"],
                    "params": response.get("params", {}),
                })
            if response.get("id") == request_id:
                if "error" in response:
                    raise RuntimeError(f"CDP {method}: {response['error']}")
                return response.get("result", {})

    def drain_events(self, duration: float = 1.0) -> None:
        """Collect asynchronous CDP events for a short observation window."""
        if not self.ws or duration <= 0:
            return
        original_timeout = self.ws.gettimeout() if hasattr(self.ws, "gettimeout") else self.timeout
        deadline = time.monotonic() + duration
        try:
            while time.monotonic() < deadline:
                remaining = max(0.01, deadline - time.monotonic())
                try:
                    self.ws.settimeout(remaining)
                    response = json.loads(self.ws.recv())
                except (websocket.WebSocketTimeoutException, TimeoutError):
                    break
                if response.get("method", "").startswith("Network."):
                    self.events.append({
                        "method": response["method"],
                        "params": response.get("params", {}),
                    })
        finally:
            self.ws.settimeout(original_timeout)

    def attach_to_target(self, target_id: str) -> None:
        result = self.command(
            "Target.attachToTarget",
            {"targetId": target_id, "flatten": True},
        )
        self.session_id = result.get("sessionId")
        if not self.session_id:
            raise RuntimeError("CDP não retornou sessionId para o target selecionado.")


DOM_SCRIPT = """() => {
  const visible = el => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const selectorFor = el => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.parentElement) {
        const siblings = [...node.parentElement.children].filter(x => x.tagName === node.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  return [...document.querySelectorAll('a,button,input,select,textarea,[role],[contenteditable="true"]')]
    .filter(visible).map((el, index) => ({
      index, tag: el.tagName.toLowerCase(), id: el.id || null,
      name: el.getAttribute('name'), role: el.getAttribute('role'),
      text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').slice(0, 200),
      type: el.getAttribute('type'), disabled: !!el.disabled,
      href: el.getAttribute('href'), selector: selectorFor(el)
    }));
}"""


def snapshot_dom(client: CDPClient) -> list[dict[str, Any]]:
    result = client.command("Runtime.evaluate", {
        "expression": f"({DOM_SCRIPT})()",
        "returnByValue": True,
        "awaitPromise": True,
    })
    return result.get("result", {}).get("value", [])


def score_action(
    action: dict[str, Any],
    state: dict[str, Any],
    from_state: str | None = None,
) -> tuple[int, list[str]]:
    """Score safe actions so exploration prefers useful, low-risk interactions."""
    score = 0
    reasons: list[str] = []
    text = (action.get("description") or "").lower()
    tag = action.get("tag")

    if not should_explore(state, action, from_state):
        return -1000, ["transition_already_explored" if from_state else "already_explored"]

    history = state.get("actions", {}).get(action_key(action), {})
    attempts = int(history.get("attempts", 0))
    score -= min(attempts * 10, 30)
    if attempts:
        reasons.append(f"attempts:{attempts}")
    else:
        score += 20
        reasons.append("never_executed")

    if tag == "button":
        score += 30
        reasons.append("button")
    elif tag == "a":
        score += 20
        reasons.append("link")

    useful_terms = {
        "upload": 50, "arquivo": 45, "file": 45, "converter": 40,
        "convert": 40, "processar": 35, "iniciar": 30, "abrir": 25,
        "continuar": 25, "next": 25, "avançar": 25, "gerar": 25,
    }
    for term, points in useful_terms.items():
        if term in text:
            score += points
            reasons.append(term)

    navigation_terms = ("logout", "sair", "cancelar", "delete", "excluir", "remover", "apagar")
    if any(term in text for term in navigation_terms):
        score -= 500
        reasons.append("risk_term")

    if action.get("href"):
        score += 5
        reasons.append("has_href")

    return score, reasons


def build_plan(dom: list[dict[str, Any]]) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    safe_actions: list[dict[str, Any]] = []
    for item in dom:
        if item.get("disabled") or not item.get("selector"):
            continue
        tag = item.get("tag")
        item_type = (item.get("type") or "").lower()
        text = (item.get("text") or "").strip()
        dangerous_terms = ("delete", "excluir", "remover", "apagar", "logout", "sair", "cancelar")
        is_destructive = any(term in text.lower() for term in dangerous_terms)
        candidate_type = "click" if tag in {"button", "a"} else (
            "file" if tag == "input" and item_type == "file" else "input"
        )
        candidate = {
            "type": candidate_type,
            "selector": item["selector"],
            "description": text or item.get("name") or tag,
            "tag": tag,
            "input_type": item_type or None,
            "href": item.get("href"),
            "disabled": bool(item.get("disabled")),
            "destructive": is_destructive,
            "requires_validation": True,
        }
        candidates.append(candidate)
        if candidate_type == "click" and not is_destructive:
            safe_actions.append(candidate)
    return {
        "candidates": candidates,
        "actions": safe_actions[:1],
        "candidate_count": len(candidates),
        "safe_action_count": len(safe_actions),
    }


def execute_click(client: CDPClient, selector: str) -> dict[str, Any]:
    expression = f"""(() => {{
      const el = document.querySelector({json.dumps(selector)});
      if (!el) return {{ok:false, error:'ELEMENT_NOT_FOUND'}};
      el.click();
      return {{ok:true, tag:el.tagName.toLowerCase()}};
    }})()"""
    result = client.command("Runtime.evaluate", {"expression": expression, "returnByValue": True})
    return result.get("result", {}).get("value", {"ok": False})


def summarize_network_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize noisy CDP Network.* events into unique request summaries."""
    requests: dict[str, dict[str, Any]] = {}
    request_ids: dict[str, str] = {}

    for event in events:
        method = event.get("method", "")
        params = event.get("params", {})
        request_id = str(params.get("requestId", ""))

        if method == "Network.requestWillBeSent":
            request = params.get("request", {})
            url = request.get("url")
            if not url:
                continue
            key = f"{request.get('method', 'GET')} {url}"
            item = requests.setdefault(key, {
                "method": request.get("method", "GET"),
                "url": url,
                "endpoint": url.split("?", 1)[0],
                "status": None,
                "resource_type": params.get("type"),
                "count": 0,
                "failed": False,
                "error": None,
            })
            item["count"] += 1
            if params.get("type"):
                item["resource_type"] = params["type"]
            if request_id:
                request_ids[request_id] = key

        elif method == "Network.responseReceived":
            response = params.get("response", {})
            url = response.get("url")
            key = request_ids.get(request_id)
            if not key and url:
                key = f"{response.get('requestHeaders', {}).get(':method', 'GET')} {url}"
            if key:
                item = requests.setdefault(key, {
                    "method": "GET",
                    "url": url or "",
                    "endpoint": (url or "").split("?", 1)[0],
                    "status": None,
                    "resource_type": params.get("type"),
                    "count": 0,
                    "failed": False,
                    "error": None,
                })
                if response.get("status") is not None:
                    item["status"] = response["status"]
                if params.get("type"):
                    item["resource_type"] = params["type"]

        elif method == "Network.loadingFailed":
            key = request_ids.get(request_id)
            if key:
                item = requests[key]
                item["failed"] = True
                item["error"] = params.get("errorText") or params.get("blockedReason")

    return sorted(
        requests.values(),
        key=lambda item: (item["endpoint"], item["method"]),
    )


def correlate_action_network(
    action: dict[str, Any] | None,
    network_summary: list[dict[str, Any]],
) -> dict[str, Any]:
    """Create a conservative correlation between the executed action and observed traffic."""
    if not action:
        return {"action": None, "matched_requests": [], "confidence": "none"}

    candidates = [
        item for item in network_summary
        if item.get("status") is not None or item.get("failed")
    ]
    return {
        "action": {
            "type": action.get("type"),
            "selector": action.get("selector"),
            "description": action.get("description"),
            "result": action.get("result"),
        },
        "matched_requests": candidates,
        "confidence": "observed_window",
    }


def markdown_map(
    target: dict[str, Any],
    dom: list[dict[str, Any]],
    plan: dict[str, Any],
    network_count: int,
    network_events: list[dict[str, Any]] | None = None,
) -> str:
    lines = [
        "# DevTrail Standalone System Map", "",
        f"- URL: \x60{target.get('url', '')}\x60",
        f"- Title: \x60{target.get('title', '')}\x60",
        f"- DOM elements: {len(dom)}",
        f"- Network events: {network_count}", "",
        "## Planned actions",
    ]
    lines.append(f"- Interactive candidates: {plan.get('candidate_count', 0)}")
    lines.append(f"- Safe click candidates: {plan.get('safe_action_count', 0)}")
    for action in plan.get("actions", []):
        lines.append(f"- \x60{action['type']}\x60 — {action['description']} — \x60{action['selector']}\x60")
    if not plan.get("actions"):
        lines.append("- Nenhuma ação segura encontrada.")
    summaries = summarize_network_events(network_events or [])
    lines.extend(["", "## Network summary", f"- Unique requests: {len(summaries)}"])
    action = plan.get("actions", [None])[0]
    correlation = correlate_action_network(action, summaries)
    lines.extend([
        "",
        "## Action → Network correlation",
        f"- Confidence: {correlation['confidence']}",
        f"- Matched requests: {len(correlation['matched_requests'])}",
    ])
    if summaries:
        lines.append("")
        for item in summaries:
            status = f" — status {item['status']}" if item["status"] is not None else ""
            resource = f" — {item['resource_type']}" if item["resource_type"] else ""
            failure = f" — ERROR: {item['error']}" if item["failed"] and item["error"] else (" — FAILED" if item["failed"] else "")
            lines.append(
                f"- `{item['method']}` — {item['endpoint']}{status}{resource} — {item['count']}x{failure}"
            )
    elif network_count:
        lines.append("- Eventos capturados, mas nenhum request pôde ser normalizado.")
    return "\n".join(lines) + "\n"


def run(
    endpoint: str,
    contains: str | None,
    output: Path | None,
    max_actions: int = 3,
) -> dict[str, Any]:
    target = select_target(list_targets(endpoint), contains)
    state_path = (output or Path("devtrail-output")) / "exploration_state.json"
    state = load_state(state_path, target)
    if target.get("webSocketDebuggerUrl"):
        client = CDPClient(target["webSocketDebuggerUrl"])
    else:
        browser_ws_url = _get_json(endpoint, "/json/version").get("webSocketDebuggerUrl")
        if not browser_ws_url:
            raise RuntimeError("Chrome CDP não forneceu WebSocket do Browser.")
        client = CDPClient(browser_ws_url)

    client.connect()
    try:
        if not target.get("webSocketDebuggerUrl"):
            client.attach_to_target(target["targetId"])

        client.command("Page.enable")
        client.command("Runtime.enable")
        client.command("Network.enable")
        client.events.clear()
        client.command("Page.reload", {"ignoreCache": False})
        client.drain_events(2.0)

        initial_dom = snapshot_dom(client)
        initial_state_id = register_state(state, initial_dom)
        state.setdefault("metrics", {})["sessions"] = state.get("metrics", {}).get("sessions", 0) + 1
        action_records: list[dict[str, Any]] = []
        all_network_events = list(client.events)

        for step in range(max(0, max_actions)):
            dom_before = snapshot_dom(client)
            state_id = register_state(state, dom_before)
            plan = build_plan(dom_before)

            ranked_actions = []
            for action in plan["candidates"]:
                if action.get("type") != "click" or action.get("destructive"):
                    continue
                score, reasons = score_action(action, state, state_id)
                if score >= 0:
                    ranked_actions.append({**action, "score": score, "score_reasons": reasons})
            ranked_actions.sort(
                key=lambda item: (-item["score"], item.get("selector", ""))
            )
            selected_action = ranked_actions[0] if ranked_actions else None
            if not selected_action:
                break

            plan["ranked_actions"] = ranked_actions
            plan["coverage_strategy"] = "prefer_unseen_actions_then_high_utility"
            plan["selected_score"] = selected_action["score"]
            plan["actions"] = [selected_action]
            pre_action_event_count = len(client.events)
            action_result = execute_click(client, selected_action["selector"])
            client.drain_events(1.0)
            dom_after = snapshot_dom(client)
            client.drain_events(0.2)

            action_network_events = list(client.events)[pre_action_event_count:]
            all_network_events.extend(action_network_events)
            executed_action = {**selected_action, "result": action_result}
            action_network_summary = summarize_network_events(action_network_events)
            correlation = correlate_action_network(executed_action, action_network_summary)

            _, explored_action_key = record_observation(
                state, dom_before, executed_action, action_result
            )
            post_state_id = fingerprint_dom(dom_after)
            transition_id = record_transition(
                state,
                state_id,
                executed_action,
                action_result,
                post_state_id,
                action_network_summary,
            )
            register_state(state, dom_after)
            state["last_state_id"] = post_state_id
            state["last_action_key"] = explored_action_key

            action_records.append({
                "step": step + 1,
                "from_state": state_id,
                "to_state": post_state_id,
                "transition_id": transition_id,
                "classification": state["transitions"][transition_id]["classification"],
                "action": executed_action,
                "network_events": len(action_network_events),
                "network_summary": action_network_summary,
                "correlation": correlation,
            })

            # Stop immediately after a navigation or failed action; the next
            # iteration is only attempted when the current target remains usable.
            if not action_result.get("ok"):
                break

        state["last_state_id"] = state.get("last_state_id", initial_state_id)
        save_state(state_path, state)

        final_dom = snapshot_dom(client)
        final_plan = build_plan(final_dom)
        network_summary = summarize_network_events(all_network_events)
        result = {
            "status": "ok",
            "target": {
                "target_id": target.get("targetId") or target.get("id"),
                "title": target.get("title"),
                "url": target.get("url"),
            },
            "dom_before": initial_dom,
            "plan": final_plan,
            "action_result": action_records[-1]["action"]["result"] if action_records else None,
            "dom_after": final_dom,
            "network_events": all_network_events,
            "network_summary": network_summary,
            "action_records": action_records,
            "exploration": {
                "initial_state_id": initial_state_id,
                "state_count": len(state["states"]),
                "action_count": len(state["actions"]),
                "actions_executed": len(action_records),
                "max_actions": max_actions,
                "transition_count": len(state["transitions"]),
                "metrics": state.get("metrics", {}),
                "graph": {
                    "nodes": list(state["states"].keys()),
                    "edges": list(state["transitions"].values()),
                },
            },
        }

        if output:
            output.mkdir(parents=True, exist_ok=True)
            (output / "system_map.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            (output / "exploration_state.json").write_text(
                json.dumps(state, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            (output / "system_map.md").write_text(
                markdown_map(
                    target, final_dom, final_plan,
                    len(all_network_events), all_network_events
                ),
                encoding="utf-8",
            )
        return result
    finally:
        client.close()

