# Excerpt from installed transformers==5.5.0 core_model_loading.py
# (lines 777-826, 1091-1125) - captured read-only for the record, not
# executed, not a copy of the full file.

# GLOBAL_WORKERS = min(4, os.cpu_count() or 4)   (line 780)

# def spawn_materialize(thread_pool, tensor, device=None, dtype=None):
#     def _job():
#         return _materialize_copy(tensor, device, dtype)
#     if thread_pool is not None:
#         return thread_pool.submit(_job)
#     else:
#         return _job   # <-- fully synchronous fallback when thread_pool is None

# Inside convert_and_load_state_dict_in_model (lines 1113-1125):
#   # We use threading by default, if not explicitly deactivated via env variable. If we have to offload,
#   # we cannot use it either to control the memory as we are under memory constraints, so we need to be sequential.
#   # When doing on-the-fly quantization, we also use sync loading to avoid worker threads loading full-precision
#   # tensors to GPU faster than the main thread can quantize them, which would cause a large memory spike.
#   has_on_the_fly_quantization = hf_quantizer is not None and not hf_quantizer.pre_quantized
#   if (
#       is_env_variable_true("HF_DEACTIVATE_ASYNC_LOAD")
#       or "disk" in device_map.values()
#       or has_on_the_fly_quantization
#   ):
#       thread_pool = None
#   else:
#       thread_pool = ThreadPoolExecutor(max_workers=GLOBAL_WORKERS)

# is_env_variable_true (transformers/utils/import_utils.py:113-115):
#   def is_env_variable_true(env_variable: str) -> bool:
#       return os.getenv(env_variable, "false").lower() in ("true", "1", "y", "yes", "on")

# HfQuantizer.pre_quantized default (transformers/quantizers/base.py:90):
#   self.pre_quantized = kwargs.pop("pre_quantized", True)
# -> for unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit (a checkpoint already
#    saved in bnb-4bit format, config.json carries quantization_config),
#    pre_quantized defaults True, so has_on_the_fly_quantization = False.
#    Neither the plain-Transformers diagnostic call nor Unsloth's call sets
#    HF_DEACTIVATE_ASYNC_LOAD or uses disk offload, so BOTH are expected to
#    construct the SAME real ThreadPoolExecutor(max_workers=min(4, cpu_count))
#    by default - no evidence of a structural difference between the two
#    loaders at this decision point.
