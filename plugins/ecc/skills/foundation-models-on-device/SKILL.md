---
name: foundation-models-on-device
description: Apple FoundationModels framework for on-device LLM — text generation, guided generation with @Generable, tool calling, and snapshot streaming in iOS 26+.
---

# FoundationModels: On-Device LLM (iOS 26)

Patterns for integrating Apple's on-device language model into apps using the FoundationModels framework. Covers text generation, structured output with `@Generable`, custom tool calling, and snapshot streaming — all running on-device for privacy and offline support.

## When to Activate

- Building AI-powered features using Apple Intelligence on-device
- Generating or summarizing text without cloud dependency
- Extracting structured data from natural language input
- Implementing custom tool calling for domain-specific AI actions
- Streaming structured responses for real-time UI updates
- Need privacy-preserving AI (no data leaves the device)

## Core Pattern — Availability Check

Always check model availability before creating a session:

```swift
struct GenerativeView: View {
    private var model = SystemLanguageModel.default

    var body: some View {
        switch model.availability {
        case .available:
            ContentView()
        case .unavailable(.deviceNotEligible):
            Text("Device not eligible for Apple Intelligence")
        case .unavailable(.appleIntelligenceNotEnabled):
            Text("Please enable Apple Intelligence in Settings")
        case .unavailable(.modelNotReady):
            Text("Model is downloading or not ready")
        case .unavailable(let other):
            Text("Model unavailable: \(other)")
        }
    }
}
```

## Core Pattern — Basic Session

```swift
// Single-turn: create a new session each time
let session = LanguageModelSession()
let response = try await session.respond(to: "What's a good month to visit Paris?")
print(response.content)

// Multi-turn: reuse session for conversation context
let session = LanguageModelSession(instructions: """
    You are a cooking assistant.
    Provide recipe suggestions based on ingredients.
    Keep suggestions brief and practical.
    """)

let first = try await session.respond(to: "I have chicken and rice")
let followUp = try await session.respond(to: "What about a vegetarian option?")
```

Key points for instructions:
- Define the model's role ("You are a mentor")
- Specify what to do ("Help extract calendar events")
- Set style preferences ("Respond as briefly as possible")
- Add safety measures ("Respond with 'I can't help with that' for dangerous requests")

## Core Pattern — Guided Generation with @Generable

Generate structured Swift types instead of raw strings:

### 1. Define a Generable Type

```swift
@Generable(description: "Basic profile information about a cat")
struct CatProfile {
    var name: String

    @Guide(description: "The age of the cat", .range(0...20))
    var age: Int

    @Guide(description: "A one sentence profile about the cat's personality")
    var profile: String
}
```

### 2. Request Structured Output

```swift
let response = try await session.respond(
    to: "Generate a cute rescue cat",
    generating: CatProfile.self
)

// Access structured fields directly
print("Name: \(response.content.name)")
print("Age: \(response.content.age)")
print("Profile: \(response.content.profile)")
```

### Supported @Guide Constraints

- `.range(0...20)` — numeric range
- `.count(3)` — array element count
- `description:` — semantic guidance for generation

## Core Pattern — Tool Calling

Let the model invoke custom code for domain-specific tasks:

### 1. Define a Tool

```swift
struct RecipeSearchTool: Tool {
    let name = "recipe_search"
    let description = "Search for recipes matching a given term and return a list of results."

    @Generable
    struct Arguments {
        var searchTerm: String
        var numberOfResults: Int
    }

    func call(arguments: Arguments) async throws -> ToolOutput {
        let recipes = await searchRecipes(
            term: arguments.searchTerm,
            limit: arguments.numberOfResults
        )
        return .string(recipes.map { "- \($0.name): \($0.description)" }.joined(separator: "\n"))
    }
}
```

### 2. Create Session with Tools

```swift
let session = LanguageModelSession(tools: [RecipeSearchTool()])
let response = try await session.respond(to: "Find me some pasta recipes")
```

### 3. Handle Tool Errors

```swift
do {
    let answer = try await session.respond(to: "Find a recipe for tomato soup.")
} catch let error as LanguageModelSession.ToolCallError {
    print(error.tool.name)
    if case .databaseIsEmpty = error.underlyingError as? RecipeSearchToolError {
        // Handle specific tool error
    }
}
```

## Core Pattern — Snapshot Streaming

Stream structured responses for real-time UI with `PartiallyGenerated` types:

```swift
@Generable
struct TripIdeas {
    @Guide(description: "Ideas for upcoming trips")
    var ideas: [String]
}

let stream = session.streamResponse(
    to: "What are some exciting trip ideas?",
    generating: TripIdeas.self
)

for try await partial in stream {
    // partial: TripIdeas.PartiallyGenerated (all properties Optional)
    print(partial)
}
```

### SwiftUI Integration

```swift
@State private var partialResult: TripIdeas.PartiallyGenerated?
@State private var errorMessage: String?

var body: some View {
    List {
        ForEach(partialResult?.ideas ?? [], id: \.self) { idea in
            Text(idea)
        }
    }
    .overlay {
        if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
    }
    .task {
        do {
            let stream = session.streamResponse(to: prompt, generating: TripIdeas.self)
            for try await partial in stream {
                partialResult = partial
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| On-device execution | Privacy — no data leaves the device; works offline |
| 4,096 token limit | On-device model constraint; chunk large data across sessions |
| Snapshot streaming (not deltas) | Structured output friendly; each snapshot is a complete partial state |
| `@Generable` macro | Compile-time safety for structured generation; auto-generates `PartiallyGenerated` type |
| Single request per session | `isResponding` prevents concurrent requests; create multiple sessions if needed |
| `response.content` (not `.output`) | Correct API — always access results via `.content` property |

## Best Practices

- **Always check `model.availability`** before creating a session — handle all unavailability cases
- **Use `instructions`** to guide model behavior — they take priority over prompts
- **Check `isResponding`** before sending a new request — sessions handle one request at a time
- **Access `response.content`** for results — not `.output`
- **Break large inputs into chunks** — 4,096 token limit applies to instructions + prompt + output combined
- **Use `@Generable`** for structured output — stronger guarantees than parsing raw strings
- **Use `GenerationOptions(temperature:)`** to tune creativity (higher = more creative)
- **Monitor with Instruments** — use Xcode Instruments to profile request performance

## Anti-Patterns to Avoid

- Creating sessions without checking `model.availability` first
- Sending inputs exceeding the 4,096 token context window
- Attempting concurrent requests on a single session
- Using `.output` instead of `.content` to access response data
- Parsing raw string responses when `@Generable` structured output would work
- Building complex multi-step logic in a single prompt — break into multiple focused prompts
- Assuming the model is always available — device eligibility and settings vary

## When to Use

- On-device text generation for privacy-sensitive apps
- Structured data extraction from user input (forms, natural language commands)
- AI-assisted features that must work offline
- Streaming UI that progressively shows generated content
- Domain-specific AI actions via tool calling (search, compute, lookup)
