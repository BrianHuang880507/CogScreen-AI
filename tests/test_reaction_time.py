from backend.app.reaction_time import reaction_time_whisper_ms


def test_reaction_time_from_words():
    transcription = {"words": [{"start": 1.23}]}
    assert reaction_time_whisper_ms(transcription) == 1230.0


def test_reaction_time_from_segments():
    transcription = {"segments": [{"start": 0.5}]}
    assert reaction_time_whisper_ms(transcription) == 500.0


def test_reaction_time_none():
    transcription = {}
    assert reaction_time_whisper_ms(transcription) is None
