"""
Generates the V2.2 ambiguity micro-remediation dataset (train additions +
a fresh, family-disjoint dev challenge set). See
docs/ai-training/qwen4b-v2-2a-ambiguity-micro-remediation.md for the full
design rationale. Targets V2.1's one remaining regression
(OVERCONFIDENT_AMBIGUITY, 7->8 / 0->1) WITHOUT damaging V2.1's genuine
reference-accuracy gains.

Architecture constraint (confirmed throughout this whole project by
reading interpreter.ts's real buildPrompt()): the production prompt is
single-turn - system instruction + optional expectedSlot + the CURRENT
user message only. There is no conversation history, no hidden
proposal/candidate-list object. Therefore "a visible unique target"
can only mean one of two things representable in a single message:
  (a) the user names the item directly (no deixis needed at all), or
  (b) the user names an antecedent EARLIER IN THE SAME MESSAGE and then
      refers back to it with a deictic word, so the referent is visible
      in the text the model actually receives, not external state.
Every "resolvable" family below uses (a) or (b). Every "unresolved"
family below has NO antecedent anywhere in the visible text (bare deixis,
or multiple plausible visible candidates with no disambiguation) - never
"no proposal was injected", since that was V2.1's own diagnosed design
error, corrected here, not repeated.

No example here is a copy/paraphrase of any existing V2/V2.1
train/validation utterance (verified separately, see leakage_check.py's
output referenced in the doc) - every family is new wording built from
the high-level failure taxonomy, not from a specific failing validation
row.

Usage:
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/generate_dataset_v2_2.py
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

OUT_DIR = Path(__file__).resolve().parents[1] / "datasets" / "raw" / "v2.2"

SYS = (
    "Bạn là bộ phân tích ngữ nghĩa cho một trợ lý thể hình tiếng Việt. CHỈ trả về một JSON object, không giải thích. "
    "Nhiệm vụ: đọc MỘT tin nhắn của người dùng và trích xuất: ý định, dữ kiện, chỉnh sửa, tham chiếu, tín hiệu mục tiêu, "
    "phủ định, điểm mơ hồ. Không tự bịa số/tên; mọi giá trị phải xuất hiện trong tin nhắn hoặc được tham chiếu rõ. "
    "Nếu không chắc, trả clarificationRequired=true và liệt kê ambiguities - KHÔNG được tự suy diễn. "
    "Schema: {primaryIntent, workflowIntent?, entities[], corrections[], references[], goalSignals[], negations[], "
    "ambiguities[], requestedAction?, asksWhy?, clarificationRequired, confidence, source}. source luôn là \"LLM\"."
)

TRAIN_FAMILIES: list[list[dict]] = []
DEV_FAMILIES: list[list[dict]] = []
_SEEN_IDS: set[str] = set()
FAMILY_DESIGN: list[dict] = []


def base_target(**overrides):
    t = {
        "primaryIntent": "UNKNOWN", "entities": [], "corrections": [], "references": [],
        "goalSignals": [], "negations": [], "ambiguities": [], "clarificationRequired": False,
        "confidence": 0.85, "source": "LLM",
    }
    t.update(overrides)
    return t


def family(case_id: str, category: str, variants: list[str], target: dict, *, boundary: str, polarity: str,
           split: str, design_note: str):
    if case_id in _SEEN_IDS:
        raise SystemExit(f"Duplicate templateFamily id: {case_id}")
    _SEEN_IDS.add(case_id)
    rows = []
    for i, text in enumerate(variants):
        rows.append({
            "caseId": f"{case_id}-{i + 1}", "category": category, "templateFamily": case_id,
            "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": text}],
            "target": target,
        })
    FAMILY_DESIGN.append({
        "family": case_id, "boundary": boundary, "polarity": polarity, "split": split,
        "exampleCount": len(variants), "note": design_note,
    })
    (TRAIN_FAMILIES if split == "train" else DEV_FAMILIES).append(rows)
    return rows


# ============================================================ A. DEICTIC_NO_VISIBLE_TARGET (unresolved) ============================================================
family("v22-deictic-no-target", "AMBIGUITY_UNKNOWN",
    ["Cái đó khó quá, đổi giúp tôi.", "Người đó tính phí sao?", "Lịch đó có ổn không?", "Mức đó cao quá."],
    base_target(primaryIntent="UNKNOWN", confidence=0.3,
                ambiguities=[{"field": "reference", "reason": "từ chỉ định không có đối tượng nào được nêu trước đó trong tin nhắn"}],
                clarificationRequired=True),
    boundary="bare deictic, zero antecedent anywhere in the visible text", polarity="negative", split="train",
    design_note="Core A-case: no exercise/PT/plan/number named anywhere in the message, so the deictic word has nothing to bind to.")

# ============================================================ B. MULTIPLE_PLAUSIBLE_TARGETS (unresolved) ============================================================
family("v22-multiple-visible-targets", "AMBIGUITY_UNKNOWN",
    ["Tôi vừa xem squat và deadlift, đổi bài đó sang bài khác đi.",
     "PT Lan và PT Minh đều ổn, chọn người đó cho tôi.",
     "Thực đơn A và thực đơn B được, lấy cái đó đi."],
    base_target(primaryIntent="UNKNOWN", confidence=0.35,
                ambiguities=[{"field": "reference", "reason": "hai mục được nêu trong câu, từ chỉ định số ít không rõ đang chọn mục nào"}],
                clarificationRequired=True),
    boundary="exactly two candidates named in the SAME message, singular deictic used without picking one",
    polarity="negative", split="train",
    design_note="Genuine ambiguity visible entirely within the text itself - two real candidates, no disambiguation, not reliant on any hidden state.")

# ============================================================ C. PT_SWITCH_NO_ACTIVE_PROPOSAL (unresolved) ============================================================
family("v22-pt-switch-no-antecedent", "AMBIGUITY_UNKNOWN",
    ["Đổi người đó giúp tôi.", "Chuyển sang PT đó nhé.", "Thay huấn luyện viên đó đi."],
    base_target(primaryIntent="UNKNOWN", confidence=0.3,
                ambiguities=[{"field": "reference", "reason": "chưa có PT/huấn luyện viên nào được nêu tên trong tin nhắn để 'đó' tham chiếu tới"}],
                clarificationRequired=True),
    boundary="PT-switch request with zero PT ever named in the message",
    polarity="negative", split="train",
    design_note="Narrower, PT-specific sibling of family A - deliberately targets the exact OVERCONFIDENT_AMBIGUITY pattern seen on validation, with fresh wording (never 'PT đó/kia' from V2.1's own families, never the validation phrasing).")

# ============================================================ D. EXERCISE_REFERENCE_NO_ACTIVE_EXERCISE (unresolved) ============================================================
family("v22-exercise-ref-no-antecedent", "AMBIGUITY_UNKNOWN",
    ["Bỏ bài đó ra khỏi lịch.", "Giảm tạ bài đó xuống.", "Bài đó thay bằng bài khác được không."],
    base_target(primaryIntent="UNKNOWN", confidence=0.3,
                ambiguities=[{"field": "reference", "reason": "chưa có bài tập nào được nêu tên trong tin nhắn để 'bài đó' tham chiếu tới"}],
                clarificationRequired=True),
    boundary="exercise-swap/removal request with zero exercise ever named in the message",
    polarity="negative", split="train",
    design_note="Exercise-specific sibling of family A.")

# ============================================================ E. UNLABELED_NUMERIC_REFERENCE (unresolved) ============================================================
family("v22-numeric-ref-no-antecedent", "AMBIGUITY_UNKNOWN",
    ["Tăng mức đó lên giúp tôi.", "Giữ số đó như cũ.", "Giảm mức đó xuống chút."],
    base_target(primaryIntent="UNKNOWN", confidence=0.3,
                ambiguities=[{"field": "reference", "reason": "chưa có con số hay mức cụ thể nào được nêu trong tin nhắn để 'mức đó/số đó' tham chiếu tới"}],
                clarificationRequired=True),
    boundary="numeric-adjustment request referring to an unlabeled number/level with none named in the message",
    polarity="negative", split="train",
    design_note="Covers deictic reference to a quantity rather than an entity - same underlying boundary, different surface target type.")

# ============================================================ F. CORRECTION_WITH_AMBIGUOUS_TARGET (unresolved) ============================================================
family("v22-correction-ambiguous-target", "AMBIGUITY_UNKNOWN",
    ["Sửa lại cái đó giúp tôi.", "Không đúng, đổi lại thành cái khác.", "Cái đó sai rồi, sửa đi."],
    base_target(primaryIntent="UNKNOWN", confidence=0.3,
                ambiguities=[{"field": "reference", "reason": "yêu cầu sửa nhưng không rõ đang sửa trường dữ liệu hay đối tượng nào"}],
                clarificationRequired=True),
    boundary="correction-shaped utterance with no identifiable field/entity target anywhere in the message",
    polarity="negative", split="train",
    design_note="Extends the ambiguity boundary to CORRECT_INFORMATION-shaped text, not just REVISE_WORKFLOW-shaped - a distinct intent surface sharing the same underlying 'no antecedent' problem.")

# ============================================================ G. FOLLOWUP_WITH_VISIBLE_UNIQUE_TARGET (resolvable, positive) ============================================================
family("v22-backreference-same-message", "REFERENCE",
    ["Squat lúc nãy nặng quá, giảm tạ bài đó xuống.",
     "PT Minh tư vấn tốt lắm, chốt người đó cho tôi.",
     "Thực đơn eat-clean vừa xem được đó, lấy cái đó đi.",
     "Lịch tập chân hôm qua ổn lắm, giữ lịch đó luôn.",
     "Gói 2 triệu vừa xem hợp lý đó, chọn gói đó cho tôi."],
    base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.78,
                references=[{"kind": "THIS_ITEM", "sourceText": "bài đó"}]),
    boundary="antecedent (squat/PT Minh/eat-clean) named earlier in the SAME message, deictic word refers back to it unambiguously",
    polarity="positive", split="train",
    design_note="The key positive contrast: the referent is visible in text the model actually receives (no conversation history needed) - teaches resolution should happen when a real antecedent exists, directly preventing the family above from over-generalizing into never resolving anything.")

# ============================================================ H. EXPLICIT_REFERENCE (resolvable, positive, no deixis) ============================================================
family("v22-explicit-named-target", "REFERENCE",
    ["Đổi bài squat sang bài khác giúp tôi.", "Chọn PT Lan cho tôi.", "Lấy thực đơn eat-clean đi.",
     "Đăng ký gói 2 triệu cho tôi.", "Giữ lịch tập chân như cũ."],
    base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.85),
    boundary="item named directly, no deictic word at all - confirms confident action is still correct when there's no ambiguity to begin with",
    polarity="positive", split="train",
    design_note="Baseline positive contrast - explicit naming needs no reference-resolution machinery at all; included so the model isn't pushed toward hedging on perfectly clear requests.")


# ============================================================ DEV CHALLENGE SET (family-disjoint, fresh wording) ============================================================
family("v22dev-deictic-no-target", "AMBIGUITY_UNKNOWN",
    ["Thôi đổi cái kia đi.", "Bên đó giá nhiêu vậy?"],
    base_target(primaryIntent="UNKNOWN", confidence=0.3,
                ambiguities=[{"field": "reference", "reason": "từ chỉ định không có đối tượng nào được nêu trước đó trong tin nhắn"}],
                clarificationRequired=True),
    boundary="dev twin of family A, fresh wording", polarity="negative", split="dev",
    design_note="Dev-only, never trained on - tests whether the A-boundary generalizes.")

family("v22dev-pt-switch-no-antecedent", "AMBIGUITY_UNKNOWN",
    ["Giúp tôi đổi huấn luyện viên kia.", "Tôi muốn thay người kia ra."],
    base_target(primaryIntent="UNKNOWN", confidence=0.3,
                ambiguities=[{"field": "reference", "reason": "chưa có PT/huấn luyện viên nào được nêu tên trong tin nhắn để 'kia' tham chiếu tới"}],
                clarificationRequired=True),
    boundary="dev twin of family C, fresh wording", polarity="negative", split="dev",
    design_note="Dev-only - directly tests the exact targeted OVERCONFIDENT_AMBIGUITY pattern with new phrasing.")

family("v22dev-multiple-visible-targets", "AMBIGUITY_UNKNOWN",
    ["Chương trình 1 với chương trình 2 đều được, lấy cái kia.", "Bench và deadlift đều nặng, bớt cái đó lại."],
    base_target(primaryIntent="UNKNOWN", confidence=0.35,
                ambiguities=[{"field": "reference", "reason": "hai mục được nêu trong câu, từ chỉ định số ít không rõ đang chọn mục nào"}],
                clarificationRequired=True),
    boundary="dev twin of family B, fresh wording", polarity="negative", split="dev",
    design_note="Dev-only.")

family("v22dev-backreference-same-message", "REFERENCE",
    ["Deadlift hôm qua nặng quá, bớt tạ cái đó đi.", "Chương trình giảm mỡ vừa xem ổn đó, lấy cái đó cho tôi."],
    base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.78,
                references=[{"kind": "THIS_ITEM", "sourceText": "cái đó"}]),
    boundary="dev twin of family G, fresh wording", polarity="positive", split="dev",
    design_note="Dev-only - tests whether the positive within-message-antecedent resolution survives alongside the negative families above.")

family("v22dev-explicit-named-target", "REFERENCE",
    ["Chọn chương trình tăng cơ cho tôi.", "Đổi sang bài deadlift giúp tôi."],
    base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.85),
    boundary="dev twin of family H, fresh wording", polarity="positive", split="dev",
    design_note="Dev-only.")

family("v22dev-numeric-ref-no-antecedent", "AMBIGUITY_UNKNOWN",
    ["Tăng số đó lên chút nữa.", "Để mức kia như cũ đi."],
    base_target(primaryIntent="UNKNOWN", confidence=0.3,
                ambiguities=[{"field": "reference", "reason": "chưa có con số hay mức cụ thể nào được nêu trong tin nhắn để tham chiếu tới"}],
                clarificationRequired=True),
    boundary="dev twin of family E, fresh wording", polarity="negative", split="dev",
    design_note="Dev-only.")


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    train_rows = [row for fam in TRAIN_FAMILIES for row in fam]
    dev_rows = [row for fam in DEV_FAMILIES for row in fam]

    (OUT_DIR / "train_remediation.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in train_rows) + "\n", encoding="utf-8")
    (OUT_DIR / "dev_challenge.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in dev_rows) + "\n", encoding="utf-8")
    (OUT_DIR / "family_design.json").write_text(
        json.dumps(FAMILY_DESIGN, indent=2, ensure_ascii=False), encoding="utf-8")

    def summarize(rows):
        pos = sum(1 for r in rows if r["target"].get("primaryIntent") != "UNKNOWN")
        neg = len(rows) - pos
        fams = {r["templateFamily"] for r in rows}
        return {"rows": len(rows), "families": len(fams), "positiveResolvable": pos, "negativeUnresolved": neg}

    print(json.dumps({"train": summarize(train_rows), "dev": summarize(dev_rows)}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
