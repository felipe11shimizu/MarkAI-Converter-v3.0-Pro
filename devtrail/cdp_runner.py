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
  return [...document.querySelectorAll('a,button,input,select,textarea,[role],[contenteditable="true"]')]
    .filter(visible).map((el, index) => ({
      index, tag: el.tagName.toLowerCase(), id: el.id || null,
      name: el.getAttribute('name'), role: el.getAttribute('role'),
      text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').slice(0, 200),
      type: el.getAttribute('type'), disabled: !!el.disabled,
      selector: el.id ? '#' + CSS.escape(el.id) : null
    }));
}"""


def snapshot_dom(client: CDPClient) -> list[dict[str, Any]]:
    result = client.command("Runtime.evaluate", {
        "expression": f"({DOM_SCRIPT})()",
        "returnByValue": True,
        "awaitPromise": True,
    })
    return result.get("result", {}).get("value", [])


def build_plan(dom: list[dict[str, Any]]) -> dict[str, Any]:
    for item in dom:
        if not item.get("disabled") and item["tag"] in {"button", "a"} and item.get("selector"):
            return {"actions": [{
                "type": "click",
                "selector": item["selector"],
                "description": item.get("text") or item["tag"],
                "requires_validation": True,
            }]}
    return {"actions": []}


def execute_click(client: CDPClient, selector: str) -> dict[str, Any]:
    expression = f"""(() => {{
      const el = document.querySelector({json.dumps(selector)});
      if (!el) return {{ok:false, error:'ELEMENT_NOT_FOUND'}};
      el.click();
      return {{ok:true, tag:el.tagName.toLowerCase()}};
    }})()"""
    result = client.command("Runtime.evaluate", {"expression": expression, "returnByValue": True})
    return result.get("result", {}).get("value", {"ok": False})


def markdown_map(
    target: dict[str, Any],\n    dom: list[dict[str, Any]],\n    plan: dict[str, Any],\n    network_count: int,\n    network_events: list[dict[str, Any]] | None = None,\n) -> str:
    lines = [
        "# DevTrail Standalone System Map", "",
        f"- URL: \x60{target.get('url', '')}\x60",
        f"- Title: \x60{target.get('title', '')}\x60",
        f"- DOM elements: {len(dom)}",
        f"- Network events: {network_count}", "",
        "## Planned actions",
    ]
    for action in plan.get("actions", []):
        lines.append(f"- \x60{action['type']}\x60 — {action['description']} — \x60{action['selector']}\x60")
    if not plan.get("actions"):
        lines.append("- Nenhuma ação segura encontrada.")
    if network_events:
        lines.extend(["", "## Network events"])
        for event in network_events:
            method = event.get("method", "unknown")
            params = event.get("params", {})
            request = params.get("request", {})
            url = request.get("url")
            status = params.get("response", {}).get("status")
            suffix = f" — {url}" if url else ""
            if status is not None:
                suffix += f" — status {status}"
            lines.append(f"- `{method}`{suffix}")
    return "\n".join(lines) + "\n"


def run(endpoint: str, contains: str | None, output: Path | None) -> dict[str, Any]:
    target = select_target(list_targets(endpoint), contains)
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
        dom_before = snapshot_dom(client)
        plan = build_plan(dom_before)
        action_result = execute_click(client, plan["actions"][0]["selector"]) if plan["actions"] else None
        time.sleep(0.2)
        dom_after = snapshot_dom(client)
        network_events = list(client.events)
        result = {
            "status": "ok", "target": {
                "target_id": target.get("targetId") or target.get("id"),
                "title": target.get("title"), "url": target.get("url")
            },
            "dom_before": dom_before, "plan": plan, "action_result": action_result,
            "dom_after": dom_after, "network_events": network_events,
        }
        if output:
            output.mkdir(parents=True, exist_ok=True)
            (output / "system_map.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            (output / "system_map.md").write_text(\n                markdown_map(target, dom_after, plan, len(network_events), network_events),\n                encoding="utf-8",\n            )
        return result
    finally:
        client.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="DevTrail standalone Chrome CDP runner")
    parser.add_argument("--endpoint", default=DEFAULT_CDP_ENDPOINT)
    parser.add_argument("--contains")
    parser.add_argument("--output", default="devtrail-output")
    args = parser.parse_args()
    result = run(args.endpoint, args.contains, Path(args.output))
    print(json.dumps({
        "status": result["status"], "target": result["target"],
        "dom_before": len(result["dom_before"]), "dom_after": len(result["dom_after"]),
        "planned_actions": len(result["plan"]["actions"]),\n        "network_events": len(result["network_events"]),\n        "action_result": result["action_result"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
