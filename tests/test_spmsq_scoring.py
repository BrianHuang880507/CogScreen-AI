from backend.app.instruments.spmsq import score_spmsq


def test_spmsq_normal():
    result = score_spmsq(2)
    assert result["interpretation"]["severity"] == "normal"


def test_spmsq_education_adjustment():
    result = score_spmsq(3, education_level="grade_school_or_less")
    assert result["interpretation"]["adjusted_errors"] == 2
