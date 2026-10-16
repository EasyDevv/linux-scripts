# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["transformers>=5.13.0", "torch", "soundfile", "librosa", "sentencepiece", "protobuf", "accelerate"]
# ///
"""nvidia/nemotron-3.5-asr-streaming-0.6b (고속 모드) 로 wav 파일들을 전사. 줄마다 JSON {file, text, sec}."""
import json, sys, time
import torch
from transformers import AutoModelForRNNT, AutoProcessor
from transformers.audio_utils import load_audio

MODEL = "nvidia/nemotron-3.5-asr-streaming-0.6b"
processor = AutoProcessor.from_pretrained(MODEL)
model = AutoModelForRNNT.from_pretrained(MODEL, device_map="cuda:0")
sr = processor.feature_extractor.sampling_rate
for f in sys.argv[1:]:
    t = time.perf_counter()
    inputs = processor(load_audio(f, sampling_rate=sr), sampling_rate=sr, language="ko-KR")
    inputs.to(model.device, dtype=model.dtype)
    out = model.generate(**inputs, return_dict_in_generate=True)
    text = processor.decode(out.sequences, skip_special_tokens=True)
    text = text[0] if isinstance(text, list) else text
    torch.cuda.synchronize()
    print(json.dumps({"file": f, "text": " ".join(text.split()), "sec": time.perf_counter() - t},
                     ensure_ascii=False), flush=True)
