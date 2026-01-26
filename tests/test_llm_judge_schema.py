from backend.app.llm_judge import JUDGE_SCHEMA


def test_judge_schema_fields():
    schema = JUDGE_SCHEMA["schema"]
    required = set(schema["required"])
    assert {
        "normalized_answer",
        "is_correct",
        "confidence",
        "reason",
        "matched_expected",
    }.issubset(required)
