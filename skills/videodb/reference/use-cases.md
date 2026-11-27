# Use Cases

Common workflows and what VideoDB enables. For code details, see [api-reference.md](api-reference.md), [capture.md](capture.md), [editor.md](editor.md), and [search.md](search.md).

---

## Video Search & Highlights

### Create Highlight Reels
Upload a long video (conference talk, lecture, meeting recording), search for key moments by topic ("product announcement", "Q&A session", "demo"), and automatically compile matching segments into a shareable highlight reel.

### Build Searchable Video Libraries
Batch upload videos to a collection, index them for spoken word search, then query across the entire library. Find specific topics across hundreds of hours of content instantly.

### Extract Specific Clips
Search for moments matching a query ("budget discussion", "action items") and extract each matching segment as an individual clip with its own stream URL.

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
Index video scenes with AI and search for problematic content. Flag videos containing violence, inappropriate content, or policy violations.

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
| Find moments in video | Index spoken words/scenes → Search → Compile clips |
| Create highlights | Search multiple topics → Build timeline → Generate stream |
| Add subtitles | Index spoken words → Add subtitle overlay |
| Record screen + AI | Start capture → Run AI pipelines → Export video |
| Monitor live streams | Connect RTSP → Index scenes → Create alerts |
| Reformat for social | Reframe to target aspect ratio |
| Combine clips | Build timeline with multiple assets → Generate stream |
