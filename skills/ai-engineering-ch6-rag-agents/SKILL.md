---
name: ai-engineering-ch6-rag-agents
description: Use when building RAG or agentic apps.
---
# RAG & Agentic Patterns (Huyen Ch 6)

## RAG Pipeline
```
Query → Embed → Retrieve (top-k) → Rerank → Context → Generate
```

## Chunking
- Fixed: 512-1024 tokens, 50-100 overlap
- Semantic: headers, paragraphs
- Recursive: hierarchical
- Parent-child: small retrieve, large context

## Retrieval & Rerank
- Dense: bi-encoder (BGE, E5), cosine
- Sparse: BM25 exact match
- Hybrid: RRF fusion
- Reranker: cross-encoder, top-50→5

## Agent Loop
```python
class Agent:
    def run(self, query):
        for _ in range(max_steps):
            thought = llm(prompt)
            action = parse(thought)
            if action.name == "final": return action.output
            obs = self.tools[action.name](action.args)
```

## Memory
- Short-term: conversation history
- Long-term: vector store
- Episodic: events with timestamps
- Semantic: extracted facts

## When to Use
- Building RAG for domain knowledge
- Designing agent workflows
