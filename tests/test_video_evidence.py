from backend.app import _enrich_analysis_evidence


def test_enrich_analysis_evidence_maps_timestamp_to_frame_and_transcript():
    analysis = {
        "etapas": [
            {"ordem": 1, "timestamp": "00:00:08", "acao": "Clique"},
            {"ordem": 2, "timestamp": "00:00:15", "acao": "Digitação"},
        ]
    }
    segments = [
        {"index": 1, "start": 7, "duration": 2, "end": 9, "text": "Clique no campo."},
        {"index": 2, "start": 14, "duration": 3, "end": 17, "text": "Digite a placa."},
    ]

    result = _enrich_analysis_evidence(
        analysis,
        transcript_segments=segments,
        frame_count=6,
        interval_seconds=5,
    )

    assert result["etapas"][0]["evidencia"]["frame_indices"] == [3]
    assert result["etapas"][0]["segmentos_transcricao"] == [1]
    assert result["etapas"][0]["evidencia_frame"] == "frame_003"
    assert result["etapas"][1]["evidencia"]["frame_indices"] == [4]
    assert result["etapas"][1]["segmentos_transcricao"] == [2]
    assert result["evidencia_resumo"]["etapas_total"] == 2
    assert result["evidencia_resumo"]["etapas_com_frame"] == 2
    assert result["evidencia_resumo"]["etapas_com_transcricao"] == 2


def test_enrich_analysis_evidence_uses_actual_adaptive_frame_timestamps():
    analysis = {
        "etapas": [
            {"ordem": 1, "timestamp": "00:00:12", "acao": "Clique"},
            {"ordem": 2, "timestamp": "00:00:29", "acao": "Digitação"},
        ]
    }
    result = _enrich_analysis_evidence(
        analysis,
        transcript_segments=[],
        frame_count=4,
        interval_seconds=5,
        frame_timestamps=[0.0, 10.0, 21.0, 30.0],
    )
    assert result["etapas"][0]["evidencia"]["frame_indices"] == [2]
    assert result["etapas"][0]["evidencia"]["frame_timestamp_seconds"] == 10.0
    assert result["etapas"][0]["evidencia"]["frame_delta_seconds"] == 2.0
    assert result["etapas"][1]["evidencia"]["frame_indices"] == [4]
    assert result["etapas"][1]["evidencia"]["frame_timestamp_seconds"] == 30.0
    assert result["etapas"][1]["evidencia"]["frame_delta_seconds"] == 1.0


def test_evidence_correlation_is_deterministic_and_separates_temporal_quality():
    from backend.app import _classify_evidence_correlation

    assert _classify_evidence_correlation(frame_count=4, frame_delta_seconds=1.5, transcript_matched=True)["status"] == "forte"
    assert _classify_evidence_correlation(frame_count=4, frame_delta_seconds=3.5, transcript_matched=False)["status"] == "aproximada"
    assert _classify_evidence_correlation(frame_count=4, frame_delta_seconds=8.0, transcript_matched=True)["status"] == "sem_correlacao_temporal"
    assert _classify_evidence_correlation(frame_count=0, frame_delta_seconds=None, transcript_matched=True)["status"] == "forte"
    assert _classify_evidence_correlation(frame_count=0, frame_delta_seconds=None, transcript_matched=False)["status"] == "sem_correlacao_temporal"
