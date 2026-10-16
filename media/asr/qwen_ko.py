# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["qwen-asr", "torch"]
# ///
"""TeamUNIVA/qwen3_asr_1.7b_ko 로 wav 파일들을 전사. 줄마다 JSON {file, text, sec}."""
import json, sys, time
import torch
from qwen_asr import Qwen3ASRModel

MODEL = "TeamUNIVA/qwen3_asr_1.7b_ko"
model = Qwen3ASRModel.from_pretrained(MODEL, dtype=torch.bfloat16, device_map="cuda:0",
                                      max_inference_batch_size=8, max_new_tokens=1024)
for f in sys.argv[1:]:
    t = time.perf_counter()
    r = model.transcribe(audio=f, language="Korean")
    torch.cuda.synchronize()
    print(json.dumps({"file": f, "text": " ".join(r[0].text.split()), "sec": time.perf_counter() - t},
                     ensure_ascii=False), flush=True)
