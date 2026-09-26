from devtrail.cdp_runner import build_plan, markdown_map, select_target


def test_select_target_by_title():
    targets = [
        {"type": "page", "title": "Other", "url": "https://example.com", "webSocketDebuggerUrl": "ws://1"},
        {"type": "page", "title": "MarkAI", "url": "https://example.test", "webSocketDebuggerUrl": "ws://2"},
    ]
    assert select_target(targets, "markai")["title"] == "MarkAI"


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
