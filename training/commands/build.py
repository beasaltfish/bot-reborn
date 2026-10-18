"""Build the simple-command dataset for a decision model.

One question per row: is the person giving the robot a movement command it can
carry out at once, and which one? Everything else is `pass` and goes to the LLM
as before. The rows use the same {state, questions, gold} shape as
LocalLLaMA/typed-decisions, so FastDecisionModel.build_dataset takes them as is.

The split is by base phrase, not by row: every surface variant of a phrase lands
on the same side, so the test set measures phrasings the model never saw.

    python3 training/commands/build.py   # writes training/commands/data/*.jsonl
"""

import json
import random
import re
from pathlib import Path

from phrases import CONTEXT, NEUTRAL_ROBOT_LINES, STANDALONE

SEED = 3407
TEST_SHARE = 0.25
OUT = Path(__file__).parent / "data"

QUESTION = {
    "action": {
        "type": "choice",
        "instructions": (
            "A person is talking to a small wheeled robot. \"Robot said\" is the robot's "
            "last line, if any; \"Person said\" is a speech-recognition transcript of what "
            "the person said. Is the person telling the robot to make one simple move it "
            "can carry out right away? Anything else, including questions, chat, complex "
            "or multi-step moves, exact distances, and words meant for someone else, is pass."
        ),
        "criteria": {
            "stop": "Stop moving now, or stay still.",
            "forward": "Move forward a little, or come closer.",
            "backward": "Move backward a little, or back away.",
            "left": "Turn or steer to the left.",
            "right": "Turn or steer to the right.",
            "keep_going": "Keep driving forward with no set end, until told to stop.",
            "pass": "Not a simple move command; let the robot think and answer.",
        },
    }
}

FILLERS = ["hey robot, ", "okay ", "um ", "robot, ", "alright, ", "hey, "]


def as_transcript(text: str) -> str:
    """What a speech recognizer often returns: lower case, no punctuation."""
    return re.sub(r"[^\w\s']", "", text).lower().strip()


def variants(text: str, label: str, rng: random.Random) -> list[str]:
    """The phrase as written, plus one noisier surface form of it."""
    # "Hey robot, Mom, stop!" would turn a line meant for someone else into one
    # meant for the robot, so pass phrases only get fillers that address no one.
    fillers = [f for f in FILLERS if "robot" not in f] if label == "pass" else FILLERS
    noisy = rng.choice([
        as_transcript(text),
        rng.choice(fillers) + text[0].lower() + text[1:],
        as_transcript(rng.choice(fillers) + text),
    ])
    return [text] if noisy == text else [text, noisy]


def state(person: str, robot: str | None) -> str:
    return (f"Robot said: \"{robot}\"\n" if robot else "") + f"Person said: \"{person}\""


def bases() -> list[tuple[str, str, str | None]]:
    """(label, person, robot_line) before any surface variation."""
    out = []
    for label, phrases in STANDALONE.items():
        out += [(label, p, None) for p in phrases]
    out += [(label, person, robot) for robot, person, label in CONTEXT]
    return out


def main() -> None:
    rng = random.Random(SEED)
    items = bases()

    # Stratified split by label, on base phrases.
    by_label: dict[str, list] = {}
    for item in items:
        by_label.setdefault(item[0], []).append(item)
    split_of = {}
    for group in by_label.values():
        rng.shuffle(group)
        n_test = round(len(group) * TEST_SHARE)
        for i, item in enumerate(group):
            split_of[item] = "test" if i < n_test else "train"

    rows = {"train": [], "test": []}
    for label, person, robot in items:
        split = split_of[(label, person, robot)]
        for text in variants(person, label, rng):
            # A standalone phrase means the same after any neutral robot line.
            # Most get one, as at run time; the rest stand for the first turn,
            # before the robot has said anything.
            line = robot or (rng.choice(NEUTRAL_ROBOT_LINES) if rng.random() < 0.75 else None)
            rows[split].append({
                "id": f"{split}_{len(rows[split]):04d}",
                "source": "context" if robot else "standalone",
                "state": state(text, line),
                "questions": json.dumps(QUESTION, ensure_ascii=False),
                "gold": json.dumps({"action": label}),
            })

    OUT.mkdir(exist_ok=True)
    for split, split_rows in rows.items():
        rng.shuffle(split_rows)
        with open(OUT / f"{split}.jsonl", "w", encoding="utf-8") as f:
            for row in split_rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        counts: dict[str, int] = {}
        for row in split_rows:
            label = json.loads(row["gold"])["action"]
            counts[label] = counts.get(label, 0) + 1
        print(split, len(split_rows), dict(sorted(counts.items())))


if __name__ == "__main__":
    main()
