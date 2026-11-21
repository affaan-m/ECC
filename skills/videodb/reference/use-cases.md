# Use Cases

Common workflows and what VideoDB enables. For code details, see [api-reference.md](api-reference.md), [indexing.md](indexing.md), [search.md](search.md), [capture.md](capture.md), and [editor.md](editor.md).

---

## Contents

- Video Search & Highlights (highlight reels, searchable libraries, analytics)
- Video Enhancement
- Real-Time Capture (Desktop/Meeting)
- Live Stream Intelligence (RTSP/RTMP)
- Content Moderation & Safety
- Platform Integration
- Workflow Summary

## Video Search & Highlights

### Create Highlight Reels
Upload a long video (conference talk, lecture, meeting recording), search for key moments by topic ("product announcement", "Q&A session", "demo"), and automatically compile matching segments into a shareable highlight reel.

### Build Searchable Video Libraries
Batch upload videos to a collection, index them for spoken word search, then query across the entire library. Find specific topics across hundreds of hours of content instantly.

### Extract Specific Clips
Search for moments matching a query ("budget discussion", "action items") and extract each matching segment as an individual clip with its own stream URL.

### Structured Video Analytics
Run `object_detection`, `brand_detection`, or `activity_recognition` analyzers, index the artifacts with `use_for=["query", "aggregate"]`, then answer questions no search engine can: "how many shots contain a logo", "which activities dominate this footage", "what is the distribution of detected objects". `aggregate(group_by=...)` computes it server-side without reading a single frame back. This has no v1 equivalent.

### Ask Questions About a Video
`video.ask(question, include_sources=True)` returns a written answer grounded in indexed content, plus the timestamped moments it drew from — instead of you searching, reading, and summarising yourself.

---

## Video Enhancement

### Add Professional Polish
Take raw footage and enhance it with:
- Auto-generated subtitles from speech
- Custom thumbnails at specific timestamps
- Background music overlays
- Intro/outro sequences with generated images

### AI-Enhanced Content
Combine existing video with generative AI:
- Generate text summaries from transcript
- Create background music matching video duration
- Generate title cards and overlay images
- Mix all elements into a polished final output

---

## Real-Time Capture (Desktop/Meeting)

### Screen + Audio Recording with AI
Capture screen, microphone, and system audio simultaneously. Get real-time:
- **Live transcription** - Speech to text as it happens
- **Audio summaries** - Periodic AI-generated summaries of discussions
- **Visual indexing** - AI descriptions of screen activity

### Meeting Capture with Summarization
Record meetings with live transcription of all participants. Get periodic summaries with key discussion points, decisions, and action items delivered in real-time.

### Screen Activity Tracking
Track what's happening on screen with AI-generated descriptions:
- "User is browsing a spreadsheet in Google Sheets"
- "User switched to a code editor with a Python file"
- "Video call with screen sharing enabled"

### Post-Session Processing
After capture ends, the recording is exported as a permanent video. Then:
- Generate searchable transcript
- Search for specific topics within the recording
- Extract clips of important moments
- Share via stream URL or player link

---

## Live Stream Intelligence (RTSP/RTMP)

### Connect External Streams
Ingest live video from RTSP/RTMP sources (security cameras, encoders, broadcasts). Process and index content in real-time.

### Real-Time Event Detection
Define events to detect in live streams:
- "Person entering restricted area"
- "Traffic violation at intersection"
- "Product visible on shelf"

Get alerts via WebSocket or webhook when events occur.

### Live Stream Search
Search across recorded live stream content. Find specific moments and generate clips from hours of continuous footage.

---

## Content Moderation & Safety

### Automated Content Review
Run a `vlm` analyzer with a schema that emits explicit moderation fields, index with `use_for=["query", "aggregate"]`, then filter and count policy violations exactly rather than searching prose descriptions for them.

### Profanity Detection
Detect and locate profanity in audio. Optionally overlay beep sounds at detected timestamps.

---

## Platform Integration

### Social Media Formatting
Reframe videos for different platforms:
- Vertical (9:16) for TikTok, Reels, Shorts
- Square (1:1) for Instagram feed
- Landscape (16:9) for YouTube

### Transcode for Delivery
Change resolution, bitrate, or quality for different delivery targets. Output optimized streams for web, mobile, or broadcast.

### Generate Shareable Links
Every operation produces playable stream URLs. Embed in web players, share directly, or integrate with existing platforms.

---

## Workflow Summary

| Goal | VideoDB Approach |
|------|------------------|
| Make a video searchable | `understand(analyzers=[...])` → `index(source=analyzer)` |
| Find moments in video | Understand → index → `search()` → `compile()` |
| Answer a question about a video | Understand → index → `ask(question, include_sources=True)` |
| Count or group what appears | Index with `use_for=["query","aggregate"]` → `aggregate(group_by=...)` |
| Filter moments on exact values | Index with a schema → `query(index_name=..., filter={...})` |
| Create highlights | Search multiple topics → Build timeline → Generate stream |
| Add subtitles | `generate_transcript()` → `add_subtitle()` |
| Record screen + AI | Start capture → Run AI pipelines → Export video |
| Monitor live streams | Connect RTSP → `rtstream.understand()` → `rtstream.index()` → Create alerts |
| Reformat for social | Reframe to target aspect ratio |
| Combine clips | Build timeline with multiple assets → Generate stream |
