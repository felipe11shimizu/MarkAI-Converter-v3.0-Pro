from devtrail.exploration_state import (
    action_key,
    empty_state,
    fingerprint_dom,
    record_observation,
    register_state,
    should_explore,
)
from devtrail.cdp_runner import (
    CDPClient,
    build_plan,
    markdown_map,
    select_target,
    score_action,
    summarize_network_events,
)


def test_select_target_by_title():
    targets = [
        {"type": "page", "title": "Other", "url": "https://example.com", "webSocketDebuggerUrl": "ws://1"},
        {"type": "page", "title": "MarkAI", "url": "https://example.test", "webSocketDebuggerUrl": "ws://2"},
    ]
    assert select_target(targets, "markai")["title"] == "MarkAI"


def test_select_target_from_browser_discovery():
    targets = [
        {"type": "background_page", "title": "OCR", "url": "chrome-extension://ocr"},
        {"type": "service_worker", "title": "DevTrail", "url": "chrome-extension://devtrail"},
        {"type": "page", "targetId": "page-1", "title": "MarkAI Converter", "url": "https://example.test"},
    ]
    assert select_target(targets, "markai")["targetId"] == "page-1"


def test_select_target_rejects_missing_page():
    try:
        select_target([{"type": "service_worker", "webSocketDebuggerUrl": "ws://1"}])
    except RuntimeError as exc:
        assert "Nenhuma aba" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")


def test_build_plan_only_uses_safe_clicks():
    plan = build_plan([
        {"tag": "input", "selector": "#name", "disabled": False},
        {"tag": "button", "selector": "#go", "text": "Executar", "disabled": False},
    ])
    assert plan["actions"][0]["type"] == "click"
    assert plan["actions"][0]["requires_validation"] is True


def test_markdown_map():
    md = markdown_map(
        {"title": "Teste", "url": "https://example.com"},
        [{"tag": "button", "selector": "#go"}],
        {"actions": [{"type": "click", "selector": "#go", "description": "Executar"}]},
        3,
    )
    assert "# DevTrail Standalone System Map" in md
    assert "Network events: 3" in md
    assert "#go" in md


class FakeWebSocket:
    def __init__(self):
        self.sent = []
        self.messages = [
            {"method": "Network.requestWillBeSent", "params": {"request": {"url": "https://example.com/api"}}},
            {"id": 1, "result": {}},
        ]

    def send(self, payload):
        self.sent.append(payload)

    def recv(self):
        import json
        return json.dumps(self.messages.pop(0))


def test_cdp_client_captures_network_events():
    client = CDPClient("ws://test")
    client.ws = FakeWebSocket()
    client.command("Runtime.enable")
    assert len(client.events) == 1
    assert client.events[0]["method"] == "Network.requestWillBeSent"
    assert client.events[0]["params"]["request"]["url"] == "https://example.com/api"


def test_markdown_map_includes_network_events():
    md = markdown_map(
        {"title": "Teste", "url": "https://example.com"},
        [{"tag": "button", "selector": "#go"}],
        {"actions": [{"type": "click", "selector": "#go", "description": "Executar"}]},
        1,
        [{"method": "Network.requestWillBeSent", "params": {"request": {"url": "https://example.com/api"}}}],
    )
    assert "Network events: 1" in md
    assert "https://example.com/api" in md


def test_summarize_network_events_groups_request_and_response():
    events = [
        {
            "method": "Network.requestWillBeSent",
            "params": {
                "requestId": "1",
                "type": "Fetch",
                "request": {
                    "url": "https://example.com/api/items?limit=10",
                    "method": "GET",
                },
            },
        },
        {
            "method": "Network.responseReceived",
            "params": {
                "requestId": "1",
                "type": "Fetch",
                "response": {
                    "url": "https://example.com/api/items?limit=10",
                    "status": 200,
                },
            },
        },
    ]
    summary = summarize_network_events(events)
    assert len(summary) == 1
    assert summary[0]["endpoint"] == "https://example.com/api/items"
    assert summary[0]["method"] == "GET"
    assert summary[0]["status"] == 200
    assert summary[0]["resource_type"] == "Fetch"
    assert summary[0]["count"] == 1


def test_summarize_network_events_marks_failures():
    events = [
        {
            "method": "Network.requestWillBeSent",
            "params": {
                "requestId": "2",
                "request": {
                    "url": "https://example.com/api/fail",
                    "method": "POST",
                },
            },
        },
        {
            "method": "Network.loadingFailed",
            "params": {
                "requestId": "2",
                "errorText": "net::ERR_FAILED",
            },
        },
    ]
    summary = summarize_network_events(events)
    assert len(summary) == 1
    assert summary[0]["failed"] is True
    assert summary[0]["error"] == "net::ERR_FAILED"


def test_action_window_can_be_summarized_independently():
    events = [
        {
            "method": "Network.requestWillBeSent",
            "params": {
                "requestId": "bootstrap",
                "request": {"url": "https://example.com/app.js", "method": "GET"},
            },
        },
        {
            "method": "Network.requestWillBeSent",
            "params": {
                "requestId": "action",
                "request": {"url": "https://example.com/api/upload", "method": "POST"},
            },
        },
        {
            "method": "Network.responseReceived",
            "params": {
                "requestId": "action",
                "response": {"url": "https://example.com/api/upload", "status": 201},
            },
        },
    ]
    action_events = events[1:]
    summary = summarize_network_events(action_events)
    assert len(summary) == 1
    assert summary[0]["endpoint"] == "https://example.com/api/upload"
    assert summary[0]["status"] == 201


def test_build_plan_catalogs_interactive_candidates():
    plan = build_plan([
        {"tag": "button", "selector": "#upload", "text": "Selecionar arquivo", "disabled": False, "type": "button"},
        {"tag": "input", "selector": "#file", "text": "", "disabled": False, "type": "file"},
        {"tag": "button", "selector": "#delete", "text": "Excluir", "disabled": False, "type": "button"},
    ])
    assert plan["candidate_count"] == 3
    assert plan["safe_action_count"] == 1
    assert plan["actions"][0]["selector"] == "#upload"
    assert plan["candidates"][1]["type"] == "file"
    assert plan["candidates"][2]["destructive"] is True


def test_exploration_state_fingerprint_is_stable():
    dom = [{"tag": "button", "id": "go", "selector": "#go", "text": "Executar"}]
    assert fingerprint_dom(dom) == fingerprint_dom(list(dom))


def test_exploration_state_records_action_and_prevents_repeat():
    state = empty_state({"title": "Teste", "url": "https://example.com"})
    dom = [{"tag": "button", "id": "go", "selector": "#go", "text": "Executar"}]
    action = {"type": "click", "selector": "#go", "description": "Executar"}
    assert should_explore(state, action) is True
    state_id, key = record_observation(state, dom, action, {"ok": True, "tag": "button"})
    assert key == action_key(action)
    assert state_id in state["states"]
    assert state["actions"][key]["attempts"] == 1
    assert should_explore(state, action) is False


def test_register_state_tracks_distinct_dom_states():
    state = empty_state({"title": "Teste", "url": "https://example.com"})
    dom_a = [{"tag": "button", "selector": "#a", "text": "A"}]
    dom_b = [{"tag": "button", "selector": "#b", "text": "B"}]
    first = register_state(state, dom_a)
    second = register_state(state, dom_b)
    assert first != second
    assert len(state["states"]) == 2


def test_score_action_prefers_useful_unexplored_action():
    state = empty_state({"title": "Teste", "url": "https://example.com"})
    upload = {"type": "click", "tag": "button", "selector": "#upload", "description": "Selecionar arquivo"}
    generic = {"type": "click", "tag": "button", "selector": "#x", "description": "Abrir"}
    assert score_action(upload, state)[0] > score_action(generic, state)[0]
    record_observation(state, [{"tag": "button", "selector": "#upload"}], upload, {"ok": True})
    assert score_action(upload, state)[0] < 0


def test_transition_graph_is_state_aware():
    state = empty_state({"title": "Teste", "url": "https://example.com"})
    action = {"type": "click", "selector": "#next", "description": "Continuar"}
    first = record_transition(state, "state-a", action, {"ok": True}, "state-b", [{"endpoint": "/api/next"}])
    second = record_transition(state, "state-b", action, {"ok": True}, "state-c", [])
    assert first == transition_key("state-a", action)
    assert second == transition_key("state-b", action)
    assert first != second
    assert len(state["transitions"]) == 2
    assert should_explore(state, action, "state-a") is False
    assert should_explore(state, action, "state-b") is False
    assert should_explore(state, action, "state-c") is True


def test_transition_classification_distinguishes_new_revisit_and_loop():
    state = empty_state({"title": "Teste", "url": "https://example.com"})
    state["states"]["state-a"] = {"dom_count": 1, "observations": 1}
    assert classify_transition(state, "state-a", "state-b") == "new_state"
    assert classify_transition(state, "state-a", "state-a") == "self_loop"
    state["states"]["state-b"] = {"dom_count": 1, "observations": 1}
    assert classify_transition(state, "state-a", "state-b") == "revisit"


def test_record_transition_updates_coverage_metrics():
    state = empty_state({"title": "Teste", "url": "https://example.com"})
    state["states"]["state-a"] = {"dom_count": 1, "observations": 1}
    action = {"type": "click", "selector": "#next", "description": "Continuar"}
    record_transition(state, "state-a", action, {"ok": True}, "state-b", [])
    assert state["metrics"]["actions"] == 1
    assert state["metrics"]["new_states"] == 1
    record_transition(state, "state-a", {"type": "click", "selector": "#loop", "description": "Abrir"}, {"ok": True}, "state-a", [])
    assert state["metrics"]["loops"] == 1
