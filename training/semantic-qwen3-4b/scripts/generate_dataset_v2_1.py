"""
Generates the V2.1 targeted-remediation ADDITIONS (not a full dataset
rebuild). See docs/ai-training/qwen4b-v2-1-reference-ambiguity-remediation.md
for the full investigation this is based on. Three corrected findings drive
every family below:

1. `detectReferences()` (backend/services/ai-service/src/conversational-
   intelligence/signals.ts) - the REAL deterministic reference resolver -
   is a pure surface-text regex matcher with ZERO memory of prior turns or
   any hidden proposal/candidate state. It confidently tags a reference
   KIND (THIS_ITEM/ORDINAL_ITEM/etc.) from text alone, unconditionally.
   Resolving WHICH concrete entity a kind points to is explicitly NOT this
   layer's job (interpreter.ts's own comment: "never authoritative state").
   V2's dataset incorrectly hedged several THIS_ITEM-pattern families into
   UNKNOWN/clarificationRequired=true specifically because "no proposal is
   visible in this single-turn prompt" - but the real system doesn't
   attempt that resolution either, and still tags confidently. That hedge
   was the dataset's bug, not a defect in the model's confident behavior.

2. V2 had an internal self-contradiction: `reference-pt-switch-request`
   (TRAIN) and `ambiguity-pt-switch-no-proposal` (VALIDATION) describe the
   identical utterance pattern ("đổi sang PT đó đi") but assign THREE
   different, mutually inconsistent primaryIntent labels across the two
   families (CONFIRM vs UNKNOWN) - neither is actually correct. The
   families below replace this confused framing with one consistent,
   actionable confident resolution (REVISE_WORKFLOW + THIS_ITEM,
   clarificationRequired=false) - using NEW phrasing, never the validation
   family's exact text (no-leakage rule, task §16).

3. The 4 residual V2 invented-enum cases are all NATURAL_SYNONYM_MAPPING_GAP
   (the model substitutes a semantically-plausible descriptive label -
   ASK_WORKFLOW, ASK_QUESTION, STOP_WORKFLOW, ASK_INFORMATION - for the
   exact required enum token) - fixed with more contrastive exposure to
   the correct token under varied natural phrasing, not a conceptual fix.

Genuine, irreducible ambiguity (no noun+deictic pattern, no number role,
no recognizable surface signal at all) is preserved and reinforced
separately - the boundary is "does the text contain a pattern
`detectReferences`/the schema can resolve", not "is downstream app state
visible", since the latter was never actually the real system's criterion.

Usage:
  training/.venv/Scripts/python.exe training/semantic-qwen3-4b/scripts/generate_dataset_v2_1.py
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

OUT_DIR = Path(__file__).resolve().parents[1] / "datasets" / "raw" / "v2.1"

SYS = (
    "Bạn là bộ phân tích ngữ nghĩa cho một trợ lý thể hình tiếng Việt. CHỈ trả về một JSON object, không giải thích. "
    "Nhiệm vụ: đọc MỘT tin nhắn của người dùng và trích xuất: ý định, dữ kiện, chỉnh sửa, tham chiếu, tín hiệu mục tiêu, "
    "phủ định, điểm mơ hồ. Không tự bịa số/tên; mọi giá trị phải xuất hiện trong tin nhắn hoặc được tham chiếu rõ. "
    "Nếu không chắc, trả clarificationRequired=true và liệt kê ambiguities - KHÔNG được tự suy diễn. "
    "Schema: {primaryIntent, workflowIntent?, entities[], corrections[], references[], goalSignals[], negations[], "
    "ambiguities[], requestedAction?, asksWhy?, clarificationRequired, confidence, source}. source luôn là \"LLM\"."
)

FAMILIES: list[list[dict]] = []
TRAIN_FAMILY_IDS: set[str] = set()
REMEDIATION_VAL_FAMILY_IDS: set[str] = set()
_SEEN_IDS: set[str] = set()


def base_target(**overrides):
    t = {
        "primaryIntent": "UNKNOWN", "entities": [], "corrections": [], "references": [],
        "goalSignals": [], "negations": [], "ambiguities": [], "clarificationRequired": False,
        "confidence": 0.85, "source": "LLM",
    }
    t.update(overrides)
    return t


def family(case_id: str, category: str, variants: list[str], target: dict, expected_slot: str | None = None, *, split: str = "train"):
    if case_id in _SEEN_IDS:
        raise SystemExit(f"Duplicate templateFamily id: {case_id}")
    _SEEN_IDS.add(case_id)
    (TRAIN_FAMILY_IDS if split == "train" else REMEDIATION_VAL_FAMILY_IDS).add(case_id)
    sys_msg = SYS if not expected_slot else SYS + f" Trợ lý vừa hỏi về ô: {expected_slot}."
    rows = []
    for i, text in enumerate(variants):
        rows.append({
            "caseId": f"{case_id}-{i + 1}", "category": category, "templateFamily": case_id,
            "messages": [{"role": "system", "content": sys_msg}, {"role": "user", "content": text}],
            "target": target,
        })
    return rows


# ============================================================ REFERENCE - confident resolution ============================================================
# Matches detectReferences()'s own noun whitelist (pt|plan|chuong trinh|
# thuc don|lich tap|nguoi|goi) plus "bai" (exercise) as a forward-compatible
# ontology extension (the schema conceptually supports it even though
# today's regex doesn't yet cover it - same precedent as V1/V2's own design
# philosophy of targeting the full schema, not the narrower current impl).
FAMILIES += [
    family("ref-this-item-pt-revise", "REFERENCE",
        ["Đổi giúp tôi PT này đi.", "PT này không hợp, đổi người khác.", "Chuyển qua PT kia giúp tôi."],
        base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.78,
                    references=[{"kind": "THIS_ITEM", "sourceText": "PT này"}])),
    family("ref-this-item-plan-confirm", "REFERENCE",
        ["Chương trình này ổn, lưu lại giúp tôi.", "Chương trình đó được rồi, chốt vậy."],
        base_target(primaryIntent="CONFIRM", requestedAction="CONFIRM", confidence=0.85,
                    references=[{"kind": "THIS_ITEM", "sourceText": "Chương trình này"}])),
    family("ref-this-item-menu-ask", "REFERENCE",
        ["Thực đơn kia bao nhiêu calo?", "Thực đơn này có hợp với tôi không?"],
        base_target(primaryIntent="ANSWER_QUESTION", requestedAction="ASK", confidence=0.78,
                    references=[{"kind": "THIS_ITEM", "sourceText": "Thực đơn kia"}])),
    family("ref-this-item-schedule-revise", "REFERENCE",
        ["Lịch tập này nặng quá, đổi giúp tôi.", "Lịch tập đó không hợp, sửa lại đi."],
        base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.78,
                    references=[{"kind": "THIS_ITEM", "sourceText": "Lịch tập này"}])),
    family("ref-this-item-person-ask-price", "REFERENCE",
        ["Người kia giá bao nhiêu?", "Người này tính phí sao?"],
        base_target(primaryIntent="ANSWER_QUESTION", requestedAction="ASK", confidence=0.78,
                    references=[{"kind": "THIS_ITEM", "sourceText": "Người kia"}])),
    family("ref-this-item-package-confirm", "REFERENCE",
        ["Gói này ổn, đăng ký giúp tôi.", "Gói kia được, chốt gói đó đi."],
        base_target(primaryIntent="CONFIRM", requestedAction="CONFIRM", confidence=0.8,
                    references=[{"kind": "THIS_ITEM", "sourceText": "Gói này"}])),
    family("ref-this-item-exercise-revise", "REFERENCE",
        ["Bài này nặng quá, đổi bài khác giúp tôi.", "Bài đó khó quá, bỏ bài này ra."],
        base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.75,
                    references=[{"kind": "THIS_ITEM", "sourceText": "Bài này"}])),
    # The corrected, consistent replacement for V2's two internally-
    # contradictory families (train's reference-pt-switch-request: CONFIRM;
    # validation's ambiguity-pt-switch-no-proposal: UNKNOWN) - neither
    # matches the real system's own "tag the kind confidently, let a later
    # layer resolve which PT" design. New phrasing throughout (no leakage).
    family("ref-this-item-pt-switch-corrected", "REFERENCE",
        ["Giúp tôi đổi sang PT này nhé.", "Tôi muốn chuyển sang PT kia luôn.", "Chốt đổi qua PT đó cho tôi."],
        base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.75,
                    references=[{"kind": "THIS_ITEM", "sourceText": "PT này"}])),
    family("ref-ordinal-item-generic-plan", "REFERENCE",
        ["Chương trình thứ ba đi.", "Lấy chương trình số 4.", "Thực đơn thứ năm được đó."],
        base_target(primaryIntent="CONFIRM", requestedAction="CONFIRM", confidence=0.8,
                    references=[{"kind": "ORDINAL_ITEM", "sourceText": "thứ ba", "ordinal": 3}])),
    family("ref-ordinal-item-exercise", "REFERENCE",
        ["Bỏ bài thứ tư ra giúp tôi.", "Bài số 3 bỏ đi."],
        base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.76,
                    references=[{"kind": "ORDINAL_ITEM", "sourceText": "thứ tư", "ordinal": 4}])),
    family("ref-first-item-plan", "REFERENCE",
        ["Chương trình đầu tiên đi.", "Lấy cái số 1 đầu danh sách."],
        base_target(primaryIntent="CONFIRM", requestedAction="CONFIRM", confidence=0.82,
                    references=[{"kind": "FIRST_ITEM", "sourceText": "đầu tiên"}])),
    family("ref-lower-option-budget", "REFERENCE",
        ["Lấy mức ngân sách thấp hơn đi.", "Chọn gói rẻ hơn giúp tôi."],
        base_target(primaryIntent="CONFIRM", requestedAction="CONFIRM", confidence=0.78,
                    references=[{"kind": "LOWER_OPTION", "sourceText": "thấp hơn"}])),
    family("ref-higher-option-intensity", "REFERENCE",
        ["Lấy mức cao hơn cho tôi.", "Chọn độ nặng cao hơn đi."],
        base_target(primaryIntent="CONFIRM", requestedAction="CONFIRM", confidence=0.78,
                    references=[{"kind": "HIGHER_OPTION", "sourceText": "cao hơn"}])),
    family("ref-accept-proposal-generic", "REFERENCE",
        ["Đồng ý với mức bạn vừa nói.", "Theo gợi ý đó luôn."],
        base_target(primaryIntent="CONFIRM", requestedAction="CONFIRM", confidence=0.8,
                    references=[{"kind": "ACCEPT_PROPOSAL", "sourceText": "mức bạn vừa nói"}])),
    family("ref-previous-state-generic", "REFERENCE",
        ["Giữ nguyên bản trước đi.", "Như cũ là được rồi."],
        base_target(primaryIntent="CORRECT_INFORMATION", requestedAction="REVISE", confidence=0.78,
                    references=[{"kind": "PREVIOUS_STATE", "sourceText": "bản trước"}])),
]

# ============================================================ AMBIGUITY_UNKNOWN - genuine, irreducible ============================================================
# Contrastive counterpart to the REFERENCE families above: these contain NO
# recognizable noun+deictic/ordinal/option pattern at all - genuinely
# unresolvable from text alone, by the SAME criterion the real
# detectReferences() regex itself would fail to match. This is the correct
# boundary (pattern-presence), not "is a proposal visible downstream".
FAMILIES += [
    family("ambig-bare-deictic-no-noun", "AMBIGUITY_UNKNOWN",
        ["đó", "kia", "cái đó đi", "lấy cái kia"],
        base_target(primaryIntent="UNKNOWN", confidence=0.3,
                    ambiguities=[{"field": "reference", "reason": "từ chỉ định không đi kèm danh từ cụ thể nào để xác định đối tượng"}],
                    clarificationRequired=True)),
    family("ambig-bare-change-verb-no-object", "AMBIGUITY_UNKNOWN",
        ["đổi đi", "sửa giúp tôi", "chuyển đi"],
        base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.3,
                    ambiguities=[{"field": "requestedAction", "reason": "động từ thay đổi không có đối tượng cụ thể nào đi kèm"}],
                    clarificationRequired=True)),
    family("ambig-bare-number-no-role-2", "AMBIGUITY_UNKNOWN",
        ["90", "1.5 triệu", "45"],
        base_target(primaryIntent="UNKNOWN", confidence=0.35,
                    ambiguities=[{"field": "entity", "reason": "con số không rõ vai trò (cân nặng, ngân sách, số buổi, hay chỉ số khác)"}],
                    clarificationRequired=True)),
    family("ambig-single-affirmation-word-2", "AMBIGUITY_UNKNOWN",
        ["được", "vậy đi", "ừ"],
        base_target(primaryIntent="UNKNOWN", confidence=0.35,
                    ambiguities=[{"field": "primaryIntent", "reason": "từ xác nhận ngắn không rõ đang xác nhận điều gì trong ngữ cảnh hiện tại"}],
                    clarificationRequired=True)),
]

# ============================================================ INTENT - enum vocabulary remediation ============================================================
# Direct fix for the 4 residual V2 invented-enum cases, all
# NATURAL_SYNONYM_MAPPING_GAP (model substitutes a plausible descriptive
# label for the exact required token) - more contrastive exposure to the
# correct token under natural phrasing variety, new wording vs V2.
FAMILIES += [
    family("enum-ask-recommendation-pt-v2", "INTENT",
        ["PT nào ổn cho tôi?", "Nên chọn PT nào đây?", "Gợi ý giúp tôi một PT phù hợp.", "Có PT nào đáng chọn không?"],
        base_target(primaryIntent="ASK_RECOMMENDATION", requestedAction="SUGGEST", confidence=0.8)),
    family("enum-dismiss-nutrition-v2", "INTENT",
        ["Khỏi cần thực đơn đó nữa.", "Dẹp thực đơn này đi.", "Không muốn thực đơn nữa."],
        base_target(primaryIntent="DISMISS", confidence=0.82)),
    family("enum-dismiss-workout-v2", "INTENT",
        ["Khỏi cần lịch tập đó nữa.", "Dẹp lịch tập này đi.", "Không muốn tập lịch này nữa."],
        base_target(primaryIntent="DISMISS", confidence=0.82)),
    family("enum-unknown-weight-ambiguous-v2", "AMBIGUITY_UNKNOWN",
        ["85kg ổn không?", "Vậy 60kg sao?"],
        base_target(primaryIntent="UNKNOWN", confidence=0.4,
                    entities=[{"type": "WEIGHT_UNLABELED", "value": 85, "sourceText": "85kg", "explicit": False, "confidence": 0.4}],
                    ambiguities=[{"field": "WEIGHT_UNLABELED", "reason": "con số cân nặng không rõ là hiện tại hay mục tiêu"}],
                    clarificationRequired=True)),
]

# ============================================================ FOLLOWUP_SLOT / REVISION - breadth (anti-specialization) ============================================================
FAMILIES += [
    family("followup-budget-word-v2", "FOLLOWUP_SLOT",
        ["3 triệu", "khoảng 3tr"],
        base_target(primaryIntent="PROVIDE_INFORMATION", confidence=0.85,
                    entities=[{"type": "BUDGET_VND", "value": 3000000, "sourceText": "3 triệu", "explicit": True, "confidence": 0.85}]),
        expected_slot="budgetVnd"),
    family("revision-change-pt-session-count-v2", "REVISION",
        ["Giảm số buổi với PT xuống giúp tôi.", "Tăng thêm buổi tập với PT đi."],
        base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.74)),
]

# ============================================================ VALIDATION_REMEDIATION split (disjoint families, never trained on) ============================================================
FAMILIES += [
    family("ref-this-item-plan-ask-val", "REFERENCE",
        ["Chương trình này có khó không?", "Chương trình kia dài bao lâu?"],
        base_target(primaryIntent="ANSWER_QUESTION", requestedAction="ASK", confidence=0.78,
                    references=[{"kind": "THIS_ITEM", "sourceText": "Chương trình này"}]), split="val"),
    family("ref-this-item-pt-switch-val", "REFERENCE",
        ["Cho tôi đổi sang PT kia.", "Muốn chuyển qua PT này."],
        base_target(primaryIntent="REVISE_WORKFLOW", requestedAction="REVISE", confidence=0.75,
                    references=[{"kind": "THIS_ITEM", "sourceText": "PT kia"}]), split="val"),
    family("ref-ordinal-item-val", "REFERENCE",
        ["Lấy lịch tập thứ hai.", "Thực đơn số 3 đi."],
        base_target(primaryIntent="CONFIRM", requestedAction="CONFIRM", confidence=0.8,
                    references=[{"kind": "ORDINAL_ITEM", "sourceText": "thứ hai", "ordinal": 2}]), split="val"),
    family("ambig-bare-deictic-val", "AMBIGUITY_UNKNOWN",
        ["cái này", "lấy nó đi"],
        base_target(primaryIntent="UNKNOWN", confidence=0.3,
                    ambiguities=[{"field": "reference", "reason": "từ chỉ định không đi kèm danh từ cụ thể nào để xác định đối tượng"}],
                    clarificationRequired=True), split="val"),
    family("enum-ask-recommendation-val", "INTENT",
        ["PT nào đáng tin cậy?", "Chọn giúp tôi PT tốt nhất."],
        base_target(primaryIntent="ASK_RECOMMENDATION", requestedAction="SUGGEST", confidence=0.8), split="val"),
    family("enum-dismiss-val", "INTENT",
        ["Không cần lịch này nữa đâu.", "Bỏ thực đơn kia đi."],
        base_target(primaryIntent="DISMISS", confidence=0.82), split="val"),
]


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = [row for fam in FAMILIES for row in fam]
    train_rows = [r for r in rows if r["templateFamily"] in TRAIN_FAMILY_IDS]
    val_rows = [r for r in rows if r["templateFamily"] in REMEDIATION_VAL_FAMILY_IDS]

    (OUT_DIR / "train_additions.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in train_rows) + "\n", encoding="utf-8")
    (OUT_DIR / "validation_remediation.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in val_rows) + "\n", encoding="utf-8")

    by_cat_train: dict[str, int] = {}
    for r in train_rows:
        by_cat_train[r["category"]] = by_cat_train.get(r["category"], 0) + 1
    by_cat_val: dict[str, int] = {}
    for r in val_rows:
        by_cat_val[r["category"]] = by_cat_val.get(r["category"], 0) + 1

    print(json.dumps({
        "trainAdditions": {"totalRows": len(train_rows), "families": len(TRAIN_FAMILY_IDS), "byCategory": dict(sorted(by_cat_train.items()))},
        "validationRemediation": {"totalRows": len(val_rows), "families": len(REMEDIATION_VAL_FAMILY_IDS), "byCategory": dict(sorted(by_cat_val.items()))},
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
