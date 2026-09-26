#!/usr/bin/env python3
"""Standalone DevTrail CDP runner without the Chrome extension."""

from __future__ import annotations
import argparse
import json
import time
import urllib.request
from pathlib import Path
from typing import Any
import websocket


def list_targets(endpoint: str = "http://127.0.0.1:9222") -> list[dict[str, Any]]:
    with urllib.request.urlopen(endpoint.rstrip("/") + "/json/list", timeout=5) as response:
        return json.load(response)


def select_target(targets: list[dict[str, Any]], contains: str | None = None) -> dict[str, Any]:
    pages = [t for t in targets if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
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
        self.ws = None

    def connect(self) -> None:
        self.ws = websocket.create_connection(self.ws_url, timeout=self.timeout)

    def close(self) -> None:
        if self.ws:
            self.ws.close()

    def command(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._id += 1
        request_id = self._id
        self.ws.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == request_id:
                if "error" in message:
                    raise RuntimeError(f"CDP {method}: {message['error']}")
                return message.get("result", {})


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


def markdown_map(target: dict[str, Any], dom: list[dict[str, Any]], plan: dict[str, Any], network_count: int) -> str:
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
    return "\n".join(lines) + "\n"


def run(endpoint: str, contains: str | None, output: Path | None) -> dict[str, Any]:
    target = select_target(list_targets(endpoint), contains)
    client = CDPClient(target["webSocketDebuggerUrl"])
    client.connect()
    try:
        client.command("Page.enable")
        client.command("Runtime.enable")
        client.command("Network.enable")
        dom_before = snapshot_dom(client)
        plan = build_plan(dom_before)
        action_result = execute_click(client, plan["actions"][0]["selector"]) if plan["actions"] else None
        time.sleep(0.2)
        dom_after = snapshot_dom(client)
        result = {
            "status": "ok", "target": {"title": target.get("title"), "url": target.get("url")},
            "dom_before": dom_before, "plan": plan, "action_result": action_result,
            "dom_after": dom_after,
        }
        if output:
            output.mkdir(parents=True, exist_ok=True)
            (output / "system_map.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            (output / "system_map.md").write_text(markdown_map(target, dom_after, plan, 0), encoding="utf-8")
        return result
    finally:
        client.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="DevTrail standalone Chrome CDP runner")
    parser.add_argument("--endpoint", default="http://127.0.0.1:9222")
    parser.add_argument("--contains")
    parser.add_argument("--output", default="devtrail-output")
    args = parser.parse_args()
    result = run(args.endpoint, args.contains, Path(args.output))
    print(json.dumps({
        "status": result["status"], "target": result["target"],
        "dom_before": len(result["dom_before"]), "dom_after": len(result["dom_after"]),
        "planned_actions": len(result["plan"]["actions"]), "action_result": result["action_result"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
