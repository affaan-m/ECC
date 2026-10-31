---
description: Guided feature development with codebase understanding and architecture focus
---

A structured feature-development workflow that emphasizes understanding existing code before writing new code.

## Phases

### 1. Discovery

- read the feature request carefully
- identify requirements, constraints, and acceptance criteria
- ask clarifying questions if the request is ambiguous

### 2. Codebase Exploration

- use `code-explorer` to analyze the relevant existing code
- trace execution paths and architecture layers
- understand integration points and conventions

### 3. Clarifying Questions

- present findings from exploration
- ask targeted design and edge-case questions
- wait for user response before proceeding

### 4. Architecture Design

- use `code-architect` to design the feature
- provide the implementation blueprint
- wait for approval before implementing

### 5. Implementation

- implement the feature following the approved design
- prefer TDD where appropriate
- keep commits small and focused

### 6. Quality Review

- use `code-reviewer` to review the implementation
- address critical and important issues
- verify test coverage

### 7. Summary

- summarize what was built
- list follow-up items or limitations
- provide testing instructions
