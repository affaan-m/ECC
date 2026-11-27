---
name: pytorch-patterns
description: PyTorch深度学习模式与最佳实践，用于构建稳健、高效且可复现的训练流程、模型架构和数据加载。
origin: ECC
---

# PyTorch 开发模式

构建稳健、高效和可复现深度学习应用的 PyTorch 惯用模式与最佳实践。

## 何时使用

* 编写新的 PyTorch 模型或训练脚本时
* 评审深度学习代码时
* 调试训练循环或数据管道时
* 优化 GPU 内存使用或训练速度时
* 设置可复现实验时

## 核心原则

### 1. 设备无关代码

始终编写能在 CPU 和 GPU 上运行且不硬编码设备的代码。

```python
# Good: Device-agnostic
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = MyModel().to(device)
data = data.to(device)

# Bad: Hardcoded device
model = MyModel().cuda()  # Crashes if no GPU
data = data.cuda()
```

### 2. 可复现性优先

设置所有随机种子以获得可复现的结果。

```python
# Good: Full reproducibility setup
def set_seed(seed: int = 42) -> None:
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    np.random.seed(seed)
    random.seed(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False

# Bad: No seed control
model = MyModel()  # Different weights every run
```

### 3. 显式形状管理

始终记录并验证张量形状。

```python
# Good: Shape-annotated forward pass
def forward(self, x: torch.Tensor) -> torch.Tensor:
    # x: (batch_size, channels, height, width)
    x = self.conv1(x)    # -> (batch_size, 32, H, W)
    x = self.pool(x)     # -> (batch_size, 32, H//2, W//2)
    x = x.view(x.size(0), -1)  # -> (batch_size, 32*H//2*W//2)
    return self.fc(x)    # -> (batch_size, num_classes)

# Bad: No shape tracking
def forward(self, x):
    x = self.conv1(x)
    x = self.pool(x)
    x = x.view(x.size(0), -1)  # What size is this?
    return self.fc(x)           # Will this even work?
```

## 模型架构模式

### 清晰的 nn.Module 结构

```python
# Good: Well-organized module
class ImageClassifier(nn.Module):
    def __init__(self, num_classes: int, dropout: float = 0.5) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
        )
        self.classifier = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(64 * 16 * 16, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = x.view(x.size(0), -1)
        return self.classifier(x)

# Bad: Everything in forward
class ImageClassifier(nn.Module):
    def __init__(self):
        super().__init__()

    def forward(self, x):
        x = F.conv2d(x, weight=self.make_weight())  # Creates weight each call!
        return x
```

### 正确的权重初始化

```python
# Good: Explicit initialization
def _init_weights(self, module: nn.Module) -> None:
    if isinstance(module, nn.Linear):
        nn.init.kaiming_normal_(module.weight, mode="fan_out", nonlinearity="relu")
        if module.bias is not None:
            nn.init.zeros_(module.bias)
    elif isinstance(module, nn.Conv2d):
        nn.init.kaiming_normal_(module.weight, mode="fan_out", nonlinearity="relu")
    elif isinstance(module, nn.BatchNorm2d):
        nn.init.ones_(module.weight)
        nn.init.zeros_(module.bias)

model = MyModel()
model.apply(model._init_weights)
```

## 训练循环模式

### 标准训练循环

```python
# Good: Complete training loop with best practices
def train_one_epoch(
    model: nn.Module,
    dataloader: DataLoader,
    optimizer: torch.optim.Optimizer,
    criterion: nn.Module,
    device: torch.device,
    scaler: torch.amp.GradScaler | None = None,
) -> float:
    model.train()  # Always set train mode
    total_loss = 0.0

    for batch_idx, (data, target) in enumerate(dataloader):
        data, target = data.to(device), target.to(device)

        optimizer.zero_grad(set_to_none=True)  # More efficient than zero_grad()

        # Mixed precision training
        with torch.amp.autocast("cuda", enabled=scaler is not None):
            output = model(data)
            loss = criterion(output, target)

        if scaler is not None:
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            scaler.step(optimizer)
            scaler.update()
        else:
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

        total_loss += loss.item()

    return total_loss / len(dataloader)
```

### 验证循环

```python
# Good: Proper evaluation
@torch.no_grad()  # More efficient than wrapping in torch.no_grad() block
def evaluate(
    model: nn.Module,
    dataloader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
) -> tuple[float, float]:
    model.eval()  # Always set eval mode — disables dropout, uses running BN stats
    total_loss = 0.0
    correct = 0
    total = 0

    for data, target in dataloader:
        data, target = data.to(device), target.to(device)
        output = model(data)
        total_loss += criterion(output, target).item()
        correct += (output.argmax(1) == target).sum().item()
        total += target.size(0)

    return total_loss / len(dataloader), correct / total
```

## 数据管道模式

### 自定义数据集

```python
# Good: Clean Dataset with type hints
class ImageDataset(Dataset):
    def __init__(
        self,
        image_dir: str,
        labels: dict[str, int],
        transform: transforms.Compose | None = None,
    ) -> None:
        self.image_paths = list(Path(image_dir).glob("*.jpg"))
        self.labels = labels
        self.transform = transform

    def __len__(self) -> int:
        return len(self.image_paths)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, int]:
        img = Image.open(self.image_paths[idx]).convert("RGB")
        label = self.labels[self.image_paths[idx].stem]

        if self.transform:
            img = self.transform(img)

        return img, label
```

### 高效的数据加载器配置

```python
# Good: Optimized DataLoader
dataloader = DataLoader(
    dataset,
    batch_size=32,
    shuffle=True,            # Shuffle for training
    num_workers=4,           # Parallel data loading
    pin_memory=True,         # Faster CPU->GPU transfer
    persistent_workers=True, # Keep workers alive between epochs
    drop_last=True,          # Consistent batch sizes for BatchNorm
)

# Bad: Slow defaults
dataloader = DataLoader(dataset, batch_size=32)  # num_workers=0, no pin_memory
```

### 针对变长数据的自定义整理函数

```python
# Good: Pad sequences in collate_fn
def collate_fn(batch: list[tuple[torch.Tensor, int]]) -> tuple[torch.Tensor, torch.Tensor]:
    sequences, labels = zip(*batch)
    # Pad to max length in batch
    padded = nn.utils.rnn.pad_sequence(sequences, batch_first=True, padding_value=0)
    return padded, torch.tensor(labels)

dataloader = DataLoader(dataset, batch_size=32, collate_fn=collate_fn)
```

## 检查点模式

### 保存和加载检查点

```python
# Good: Complete checkpoint with all training state
def save_checkpoint(
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    epoch: int,
    loss: float,
    path: str,
) -> None:
    torch.save({
        "epoch": epoch,
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "loss": loss,
    }, path)

def load_checkpoint(
    path: str,
    model: nn.Module,
    optimizer: torch.optim.Optimizer | None = None,
) -> dict:
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    model.load_state_dict(checkpoint["model_state_dict"])
    if optimizer:
        optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
    return checkpoint

# Bad: Only saving model weights (can't resume training)
torch.save(model.state_dict(), "model.pt")
```

## 性能优化

### 混合精度训练

```python
# Good: AMP with GradScaler
scaler = torch.amp.GradScaler("cuda")
for data, target in dataloader:
    with torch.amp.autocast("cuda"):
        output = model(data)
        loss = criterion(output, target)
    scaler.scale(loss).backward()
    scaler.step(optimizer)
    scaler.update()
    optimizer.zero_grad(set_to_none=True)
```

### 大模型的梯度检查点

```python
# Good: Trade compute for memory
from torch.utils.checkpoint import checkpoint

class LargeModel(nn.Module):
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Recompute activations during backward to save memory
        x = checkpoint(self.block1, x, use_reentrant=False)
        x = checkpoint(self.block2, x, use_reentrant=False)
        return self.head(x)
```

### 使用 torch.compile 加速

```python
# Good: Compile the model for faster execution (PyTorch 2.0+)
model = MyModel().to(device)
model = torch.compile(model, mode="reduce-overhead")

# Modes: "default" (safe), "reduce-overhead" (faster), "max-autotune" (fastest)
```

## 快速参考：PyTorch 惯用法

| 惯用法 | 描述 |
|-------|-------------|
| `model.train()` / `model.eval()` | 训练/评估前始终设置模式 |
| `torch.no_grad()` | 推理时禁用梯度 |
| `optimizer.zero_grad(set_to_none=True)` | 更高效的梯度清零 |
| `.to(device)` | 设备无关的张量/模型放置 |
| `torch.amp.autocast` | 混合精度以获得 2 倍速度 |
| `pin_memory=True` | 更快的 CPU→GPU 数据传输 |
| `torch.compile` | JIT 编译加速 (2.0+) |
| `weights_only=True` | 安全的模型加载 |
| `torch.manual_seed` | 可复现的实验 |
| `gradient_checkpointing` | 以计算换取内存 |

## 应避免的反模式

```python
# Bad: Forgetting model.eval() during validation
model.train()
with torch.no_grad():
    output = model(val_data)  # Dropout still active! BatchNorm uses batch stats!

# Good: Always set eval mode
model.eval()
with torch.no_grad():
    output = model(val_data)

# Bad: In-place operations breaking autograd
x = F.relu(x, inplace=True)  # Can break gradient computation
x += residual                  # In-place add breaks autograd graph

# Good: Out-of-place operations
x = F.relu(x)
x = x + residual

# Bad: Moving data to GPU inside the training loop repeatedly
for data, target in dataloader:
    model = model.cuda()  # Moves model EVERY iteration!

# Good: Move model once before the loop
model = model.to(device)
for data, target in dataloader:
    data, target = data.to(device), target.to(device)

# Bad: Using .item() before backward
loss = criterion(output, target).item()  # Detaches from graph!
loss.backward()  # Error: can't backprop through .item()

# Good: Call .item() only for logging
loss = criterion(output, target)
loss.backward()
print(f"Loss: {loss.item():.4f}")  # .item() after backward is fine

# Bad: Not using torch.save properly
torch.save(model, "model.pt")  # Saves entire model (fragile, not portable)

# Good: Save state_dict
torch.save(model.state_dict(), "model.pt")
```

**请记住**：PyTorch 代码应做到设备无关、可复现且内存意识强。如有疑问，请使用 `torch.profiler` 进行分析，并使用 `torch.cuda.memory_summary()` 检查 GPU 内存。
