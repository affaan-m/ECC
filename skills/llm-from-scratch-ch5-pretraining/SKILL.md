---
name: llm-from-scratch-ch5-pretraining
description: Use when pretraining LLMs — loss, training loop, weights.
---
# Pretraining LLMs (Raschka Ch 5)

## Loss
- Cross-entropy on next-token prediction
- Flatten (batch*seq_len, vocab_size)

## Training Loop
```python
def train_model(model, train_loader, val_loader, optimizer, device, num_epochs):
    for epoch in range(num_epochs):
        model.train()
        for x, y in train_loader:
            loss = calc_loss_batch(x, y, model, device)
            loss.backward(); optimizer.step()
        val_loss = evaluate(model, val_loader, device)
        save_checkpoint(model, optimizer, epoch)
```

## Decoding
- Temperature, top-k, top-p

## Weight Management
- Save/load state_dict
- Map OpenAI GPT-2 weights

## When to Use
- Pretraining on custom corpus
- Loading pretrained weights
