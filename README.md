# Qwen3.8-9B Distill — Q4_K_M

Model download and instructions for an 8 GB VRAM setup.

**[Download the model](https://github.com/AOSPAndroid/tools/releases/tag/qwen3.8-9b-q4-k-m)**

- Model: Empero's community Qwen3.8-9B distillation, using the Qwen3.5-9B architecture. This is not an official Alibaba 9B Qwen3.8 release.
- Format: GGUF, Q4_K_M quantization; 5,780,090,176 bytes (5.78 GB).
- Download all four `.part001` through `.part004` assets and follow the release's `README.txt` to reassemble them.
- Verify the resulting model against `MODEL-SHA256SUM.txt` before loading.
- Use a recent LM Studio or llama.cpp with Qwen3.5 / Gated DeltaNet support. Start with 4,096 context tokens and one simultaneous request; fit and speed depend on your GPU and runtime.
- License, upstream model card and checksums are included in the release.

## Source

[empero-ai/Qwen3.8-9B-Distill-GGUF](https://huggingface.co/empero-ai/Qwen3.8-9B-Distill-GGUF), revision `760121cd70bb4c36b2b5ec58eb765e0df5987efe`.

SHA-256 of the reassembled GGUF:

```text
df13d66021cef676f82be74053220fd75af6bf2a6a7fb77f5222ab9e50744a7a
```
