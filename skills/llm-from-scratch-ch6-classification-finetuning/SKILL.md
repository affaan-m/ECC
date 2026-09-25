---
name: llm-from-scratch-ch6-classification-finetuning
description: Use when fine-tuning LLMs for classification.
---
# Classification Fine-Tuning (Raschka Ch 6)

## FT Categories
1. Feature-based: freeze backbone, train head
2. Full FT: update all params
3. LoRA/Adapters: small trainable modules

## Classification Head
```python
class ClassificationHead(nn.Module):
    def __init__(self, emb_dim, num_classes):
        self.head = nn.Sequential(
            nn.Linear(emb_dim, emb_dim), nn.GELU(),
            nn.Linear(emb_dim, num_classes))
    def forward(self, x):
        return self.head(x[:, -1, :])  # last token for GPT
```

## Training
- Lower LR (1e-4 → 1e-5)
- Fewer epochs (3-5)
- Monitor accuracy, F1

## When to Use
- Adapting pretrained LLM to classification
- Spam, sentiment, topic classification
