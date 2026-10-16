"""
Shared, verified (masking_diagnostic.py) assistant-only-loss token
construction. Used by both the diagnostic and the real trainer so there is
exactly one implementation, not two that could drift apart.
"""
from typing import Any


def _ids(result: Any) -> list[int]:
    """apply_chat_template(tokenize=True) returns a BatchEncoding (dict-like,
    pull out "input_ids") on a plain AutoTokenizer, but Unsloth's own
    patched tokenizer (the one actually used inside run_training, via
    FastLanguageModel.from_pretrained) returns a plain list of ints
    directly for the same call - handle both rather than assume one.
    BatchEncoding subclasses collections.UserDict (a Mapping), NOT dict
    itself, so isinstance(result, dict) is False for it - must check for
    a mapping-like object instead (hasattr "keys"), not plain dict."""
    return result["input_ids"] if hasattr(result, "keys") else result


def think_scaffold_ids(tokenizer: Any) -> list[int]:
    """The exact token ids Qwen3's chat template always inserts at the start
    of a non-thinking assistant turn. Ollama's own serving template (checked
    via `ollama show --modelfile`) has no <think> handling for the
    assistant role at all - stripped so training matches real serving."""
    return _ids(tokenizer("<think>\n\n</think>\n\n", add_special_tokens=False))


def strip_prefix_once(ids: list[int], prefix: list[int]) -> list[int]:
    if prefix and ids[: len(prefix)] == prefix:
        return ids[len(prefix):]
    return ids


def build_input_ids_and_labels(tokenizer: Any, prompt_messages: list[dict], completion_messages: list[dict]) -> dict:
    """Returns {input_ids, labels, isPrefix} for one example: labels is -100
    for every prompt token and the real token id for every completion
    token, with the think-scaffold stripped from the completion. Raises if
    the chat template is not prefix-stable for this model (the invariant
    this whole approach depends on) - callers must not silently continue."""
    prompt_ids = _ids(tokenizer.apply_chat_template(prompt_messages, tokenize=True, add_generation_prompt=True))
    full_ids_raw = _ids(tokenizer.apply_chat_template(prompt_messages + completion_messages, tokenize=True, add_generation_prompt=False))

    if full_ids_raw[: len(prompt_ids)] != list(prompt_ids):
        raise RuntimeError(
            "Chat template is not prefix-stable for this model/version - the "
            "tokenize-prompt / tokenize-prompt+completion masking approach is unsafe here."
        )

    scaffold = think_scaffold_ids(tokenizer)
    completion_ids = strip_prefix_once(full_ids_raw[len(prompt_ids):], scaffold)

    input_ids = list(prompt_ids) + list(completion_ids)
    labels = [-100] * len(prompt_ids) + list(completion_ids)
    return {"input_ids": input_ids, "labels": labels, "isPrefix": True}
