"""Quiz validation and grading (backend plan §14, §19): pure code, exact against the key."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from app.domain import quiz
from app.domain.workflow import QuizQuestion


def q(prompt: str, options: list[str] | None = None, answer: int = 0, **kw):
    return {"prompt": prompt, "options": options or ["A", "B", "C", "D"], "answer_index": answer, **kw}


def test_validate_drops_bad_questions_with_reasons():
    out = quiz.validate([
        q("What is an index?"),
        q("Duplicate options", ["A", "a ", "B"]),
        q("Answer out of range", answer=4),
        q("Negative answer", answer=-1),
        q("  what is an INDEX?? "),  # same prompt, normalized
        q("Already in the quiz"),
        q("Too few options", ["A", "B"]),
        q(""),
        q("Second good one", ["x", "y", "z"], answer=2, difficulty="hard"),
        q("Over the count"),
    ], want=2, existing=["Already in the quiz."])
    assert [x.prompt for x in out.questions] == ["What is an index?", "Second good one"]
    assert out.questions[1].answer_index == 2 and out.questions[1].difficulty == "hard"
    assert [d.reason.split(":")[0] for d in out.dropped] == [
        "options are not distinct", "answer_index is out of range", "answer_index is out of range",
        "duplicate prompt", "duplicate prompt", "invalid", "empty prompt", "over the requested count"]
    assert len({x.id for x in out.questions}) == 2


def test_snapshot_hides_answers_and_explanations():
    question = QuizQuestion(id="q1", prompt="P", options=["a", "b", "c"], answer_index=1, explanation="because")
    [snap] = quiz.snapshot([question])
    assert snap.model_dump() == {"id": "q1", "prompt": "P", "options": ["a", "b", "c"]}


KEY = [QuizQuestion(id=f"q{i}", prompt=f"Question {i}", options=["a", "b", "c", "d"], answer_index=i % 4,
                    explanation=f"Because {i}") for i in range(7)]


def test_grade_is_exact_and_ignores_invalid_answers():
    snap = quiz.snapshot(KEY)
    key = {k.id: k for k in KEY}
    answers = {"q0": 0, "q1": 1, "q2": 0, "q3": 9, "q4": True, "nope": 1, "q5": "1"}  # 2 correct
    g = quiz.grade(snap, key, answers)
    assert (g.correct, g.total, g.score) == (2, 7, 28.6)
    assert [r.chosen for r in g.results] == [0, 1, 0, None, None, None, None]
    assert g.results[2].correct is False and g.results[2].explanation == "Because 2"
    # A question removed from the key after the attempt started counts as wrong, not as missing.
    del key["q0"]
    assert quiz.grade(snap, key, answers).score == round(100 / 7, 1)
    assert quiz.grade([], {}, {}).score == 0.0


@given(st.lists(st.integers(min_value=0, max_value=3), min_size=7, max_size=7))
def test_grade_matches_the_key(choices):
    snap = quiz.snapshot(KEY)
    answers = {f"q{i}": c for i, c in enumerate(choices)}
    expected = sum(c == i % 4 for i, c in enumerate(choices))
    g = quiz.grade(snap, {k.id: k for k in KEY}, answers)
    assert g.correct == expected and g.score == round(100 * expected / 7, 1)


def test_generated_questions_accept_the_question_key_models_use():
    """Seen with google/gemma-4-31b-it: `question` instead of `prompt`, plus extra keys."""
    from app.llm.prompts.quiz import QuizGenerateOutput

    out = QuizGenerateOutput.model_validate({"questions": [
        {"question": "Q1?", "options": ["a", "b", "c"], "answer_index": "1", "skill": "Python"},
        {"prompt": "Q2?", "options": ["a", "b", "c"], "answer_index": 0},
    ]})
    assert [q.prompt for q in out.questions] == ["Q1?", "Q2?"] and out.questions[0].answer_index == 1
