---
name: pingtop-content-factory
description: >
  A 5-stage AI content pipeline using the Video Studio MCP, focused on viral UGC content
  for the PingTop platform — split evenly across 5 formats: UGC Challenge, Live Announce,
  Service Demo, Feature Review, ASMR Screen. Button-driven UX — clicks only, no typed
  commands. Stage 1: probe Video Studio capability, research trends in super-app / all-in-one
  platform niche on TikTok, Instagram, YouTube, and turn them into 15+ ideas across 5 formats.
  Stage 2: produce one HTML video content plan. Stage 3: generate videos one format batch at a
  time, then auto-generate the image asset pack. Stage 4: export a scheduling calendar.
  Stage 5: render a cost comparison report. Trigger on a PingTop screenshot/mockup + content
  request, or phrases like "create a campaign", "content plan for PingTop", "shoot a video",
  "run the content pipeline", "create an army", "launch the content factory".
---

# PingTop Content Factory (Video Studio MCP Edition)

A 5-stage pipeline: Research → Plan → Generate → Schedule → Report.

## What is PingTop

PingTop is an all-in-one digital ecosystem: social network (short videos, feeds), messenger
(chats, calls), live streaming, an online-services marketplace (expert consultations), and
AI tools. The core idea: people communicate, create content, learn, and monetize — inside one
app, without switching between dozens of services.

**Three campaign narratives:**
- "I found everything in one place" — user shows how they replaced several apps
- "I earned here" — expert or creator monetizes skills through the platform
- "I discovered something new" — user finds an AI feature, a live stream, or an expert

**Content focus is UGC-first.** Every campaign defaults to the 5 UGC formats below.
Cinematic styles are secondary — only on explicit request.

**UX is button-driven.** Every clarifying question MUST use AskUserQuestion with 2–4 option
buttons. Never ask free-form questions for navigation. Free-form input is reserved ONLY for
attaching a PingTop screenshot/logo or pasting a URL.

**Language rule (HARD).** No MCP tool names, no UUIDs, no "calling generate_video",
no "style parameters", no technical details. Everything runs silently. One clear banner per
stage, in plain language. All internal tool calls happen behind the scenes.

Approved stage banners:

| Stage | Banner |
|---|---|
| 1 | 🔍 **Stage 1: Research & ideas — starting now.** I'm scanning what's trending this week in the super-app and social platform niche across TikTok, Instagram, and YouTube, then turning the trends into 15+ viral video ideas for PingTop. |
| 2 | 🗂️ **Stage 2: Content plan — starting now.** I'm building your full video content plan as a polished HTML document, with every video mapped, dated, and ready to generate. |
| 3 | 🎬 **Stage 3: Generating videos — starting now.** I'm producing your videos one format batch at a time. I'll ask before each batch fires, so you stay in control. |
| 3-img | 🖼️ **Image asset pack — starting now.** I'm generating social posts, hero banners, and interface stills via AI image generation. |
| 4 | 📅 **Stage 4: Scheduling calendar — starting now.** I'm building your publishing schedule and preparing everything for Meta Ads or manual posting. |
| 5 | 💰 **Stage 5: Cost report — starting now.** I'm compiling how much was spent vs. what the same volume would cost produced traditionally. |

Between stages: one line "Stage [N] done — [deliverable]", then immediately the next banner.
No verbose recaps.

---

## ONBOARDING — Single-shot, no pauses

> ⚠️ CRITICAL: Ask ALL questions A, B, C, D in ONE single AskUserQuestion call.
> Do NOT ask them sequentially. If the user already attached a PingTop screenshot/logo,
> skip D. Once the user clicks their answers, proceed immediately — no extra confirmation.

**Step A — Check Video Studio MCP connection** (buttons)
"Yes — connected" · "Not yet — I'll connect now" · "Skip — research only"

**Step B — Confirm starting stage** (buttons)
- "Stage 1 — Full pipeline (needs PingTop screenshot or logo)"
- "Stage 2 — Build content plan (I have a brief)"
- "Stage 3 — Generate now (I have a plan)"
- "Stage 4 — Schedule only (content is ready)"

**Step C — Set video volume** (buttons)
"50 videos" · "100 videos (Recommended)" · "150 videos" · "200 videos" · "Other — type a number"
Store as [VIDEO_COUNT]. Compute `floor(VIDEO_COUNT / 5)` per format internally. Do NOT show
the breakdown to the user at this step.

**Step D — Get PingTop materials** (if not already attached)
"Attach a PingTop screenshot, logo, or drop a landing page URL — that's all I need to start."

---

## VIDEO STUDIO CAPABILITY — Internal reference

> Execute all capability checks silently. Never show tool names, parameter names, or UUIDs.

### Available styles (map to Higgsfield presets)

| Style slug (internal) | User-friendly name | Maps from Higgsfield | Best for |
|---|---|---|---|
| `UGC` | UGC / Challenge | `ugc` | Real-person moments, challenges, ASMR, live clips |
| `Product Demo` | Product Demo | `product_review` + `ugc_unboxing` | Expert demos, service previews, feature unboxing |
| `App Promo` | App Promo | `tutorial` | How-to, feature walkthroughs, step-by-step demos |
| `School Viral Reel` | Viral Reel | — | Fast-paced Gen-Z style, trending sound, energy |
| `Cinematic` | Cinematic | `tv_spot` + `hyper_motion` | Premium lifestyle, brand storytelling |
| `AI Social Platform Ad` | Social Ad | `wild_card` | Surreal/eye-catching concepts, scroll-stopper ads |
| `Character Story` | Character Story | — | Character-driven narrative, consistent persona |

### Available models (quality tiers)

| Model ID (internal) | Speed/Quality | Credits | Best for |
|---|---|---|---|
| `replicate-wan-t2v` | Fast / Good | 10 | UGC, viral reels, social clips |
| `replicate-wan-i2v` | Fast / Good | 10 | Image-to-video, ASMR, reference-based |
| `replicate-luma` | Medium / Great | 15 | Lifestyle, feature demos, smooth motion |
| `replicate-kling` | Slower / Best | 20 | Cinematic, expert demos, premium quality |

### Camera motions (replace Higgsfield hooks)

| Camera motion | Maps from hook | Vibe |
|---|---|---|
| `Handheld` | Camera Bump, Epic Fail, Product Hit | Authentic, raw, UGC energy |
| `Zoom in` | Product Dodge, Blizzard | Tension, reveal, attention-grab |
| `Dolly in` | Spicy | Cinematic, professional, engaging |
| `Orbit` | Interview | Social, dynamic, talking-head |
| `Pan` | Product Crash | Dramatic, wide reveal |
| `Static` | None | ASMR, clean demo, screen recording style |

### Hard limits

- **Duration:** **15 seconds ONLY.** Never generate 5s or 10s clips. Every video is 15s.
- **Aspect ratios:** 9:16 (primary) · 1:1 · 16:9
- **Audio:** `generate_audio: true` on EVERY video. Characters always speak — narrate PingTop value.
- **Reference image:** always pass a feature-specific PingTop screenshot as `reference_image_url`

### What Video Studio CANNOT do reliably (do not propose ideas needing these)

- ❌ Clips longer than 15 seconds
- ❌ Reliable lip-sync for non-human characters
- ❌ Multi-character coordinated dialogue with consistent identities
- ❌ Split-screen / day-1-vs-day-7 in a single clip
- ❌ Free-form camera motion not in the picklist above

**Escape hatch:** For ideas that need longer narrative or multi-shot continuity, label
"Outside Video Studio" — use `replicate-kling` (best motion) or `replicate-luma` (best
realism). Use sparingly — keep ~75% of ideas inside the standard pipeline.

---

## PINGTOP UI REFERENCE LIBRARY

Videos that show the **real PingTop app UI** earn far more viewer trust than AI-invented
interfaces. Before generating any video or image where PingTop's screen appears, check
if a real screenshot exists for that specific feature.

### Feature slugs and detection keywords

| Feature slug | Trigger keywords in scene prompt | What to request |
|---|---|---|
| `pingtop_logo` | (always — every video) | Logo / brand image |
| `pingtop_feed` | feed, scroll, timeline, short video, posts, swipe | Social feed screenshot |
| `pingtop_livestream` | live, stream, Q&A live, broadcast, going live, viewers | Livestream player UI |
| `pingtop_chat` | chat, message, conversation, typing, consultation, video call | Chat / messaging UI |
| `pingtop_marketplace` | expert, service, marketplace, hire, book, profile card | Expert card / service listing |
| `pingtop_ai_tools` | AI feature, AI tool, AI generation, wave animation, AI result | AI feature interface |

### In-session reference cache

Maintain as `REFERENCE_LIBRARY: { [slug]: { url: string, label: string } }`.
Save each entry when the user provides a URL. Persist for the entire pipeline session.

### Reference check protocol (run before EACH video or image that shows app UI)

1. From the scene prompt, detect which feature slug is needed.
2. **If `REFERENCE_LIBRARY[slug]` exists:**
   > AskUserQuestion: "This clip shows PingTop's **[feature label]**. I have your saved
   > screenshot ready."
   > - "Use saved [feature] screenshot ✓ (Recommended)"
   > - "No — I'll send a new one"
   - If "New": run step 3 below, update cache entry.
3. **If not yet in library:**
   > AskUserQuestion: "This clip shows PingTop's **[feature label]** on screen. Sharing
   > a real screenshot makes the UI look authentic and builds viewer trust. Got one?"
   > - "Yes — paste the public image URL now"
   > - "Skip — use logo reference only"
   - If URL provided: `media_import_url(url, type='image')` → store as
     `REFERENCE_LIBRARY[slug]`.
4. Pass the detected feature URL as the **primary** `reference_image_url`.
   Always also include `pingtop_logo` URL as secondary context.

> ⚠️ Ask for each unique feature slug ONCE per batch — not before every single video.
> If the same feature appears in 10 videos in a row, ask once, then reuse silently.

---

## 5 PINGTOP UGC FORMAT DEFINITIONS

Every campaign distributes evenly: `floor(VIDEO_COUNT / 5)` per format.
Remainder distributed starting from Format 1.

| # | Format | Share | Count |
|---|---|---|---|
| 1 | **UGC Challenge** | 20% | `floor(N/5)` |
| 2 | **Live Announce** | 20% | `floor(N/5)` |
| 3 | **Service Demo** | 20% | `floor(N/5)` |
| 4 | **Feature Review** | 20% | `floor(N/5)` |
| 5 | **ASMR Screen** | 20% | `floor(N/5)` |

### Format 1 — UGC Challenge
**Vibe:** community energy, real people showing skills and daring others.
**Style:** `UGC` · **Model:** `replicate-wan-t2v` · **Camera:** `Handheld` · **Duration:** 15s
**Audio:** on — character speaks VO about PingTop throughout
**Concept seeds:**
- "Show your hidden talent on PingTop — filming yourself"
- "Guess how many subscribers this expert has" — blind test
- "I found an expert in 60 seconds" — timer, rising tension
- "I'll give you $100 if you find me an expert right now"
- First-touch reaction: opening the app, face in frame
- "Trying this AI feature — let's see what happens"

### Format 2 — Live Announce / Stream Highlight
**Vibe:** feel of "live", not staged. Urgency of broadcast, FOMO.
**Style:** `UGC` · **Model:** `replicate-wan-t2v` · **Camera:** `Zoom in` · **Duration:** 15s
**Audio:** on — character narrates live energy and PingTop feature value
**Concept seeds:**
- Phone screen showing "Live Q&A" — person drops everything
- "I just ran a consultation on PingTop — here's how it went"
- Before/after: empty chat → "340 people joined"
- Teaser announce: expert face, "Tomorrow 7PM — watch"
- Reaction montage: emoji reactions flying across screen
- "I joined a stream by accident — stayed for an hour"

### Format 3 — Service Demo
**Vibe:** trust, expertise, practical value. Like Erewhon-style interviews, but professionals.
**Style:** `Product Demo` · **Model:** `replicate-kling` · **Camera:** `Dolly in` · **Duration:** 15s
**Audio:** on — expert character speaks directly to camera, delivers real PingTop service value
**Concept seeds:**
- Expert explains a complex topic in 15 seconds (lawyer, nutritionist, designer)
- "Ask me anything — I'll answer right now" interactive format
- Comparison: "YouTube tutorial vs. PingTop consultation"
- "I paid $7 for a session and here's what I got"
- Expert profile review: rating, reviews, specialization
- First 10 seconds of a video call session

### Format 4 — Feature Review
**Vibe:** honest, direct talk. Phone in hand, big screen visible.
**Style:** `App Promo` · **Model:** `replicate-wan-t2v` · **Camera:** `Static` · **Duration:** 15s
**Audio:** on — character reviews the feature out loud, names specific PingTop benefits
**Concept seeds:**
- "Three PingTop AI features nobody knows about"
- Marketplace browse: "Found a nutritionist in 2 minutes — showing you"
- Feature rating: "This is 10/10, this is 7/10, and this one is a 4"
- "I deleted TikTok after this" — PingTop demo station
- "One week with PingTop: 5 apps replaced — results"
- Chat interface comparison with WhatsApp/Telegram

### Format 5 — ASMR Screen
**Vibe:** quiet, deliberate, soothing. Tap sounds + soft whispered narration.
**Style:** `School Viral Reel` · **Model:** `replicate-wan-i2v` · **Camera:** `Static` · **Duration:** 15s
**Audio:** on — ASMR style: soft whispered VO over tap sounds, no music
**Settings vibe:** Bedroom/Office (cozy, quiet) — never street, car, gym
**Concept seeds:**
- Slow scroll of PingTop feed — tactile swipe sounds
- Opening expert chat: typing a message, sending, reply arrives
- Launching AI tool: wave animation, generation, result
- Incoming message sound × 5, soft chime
- Profile setup: photo upload, description, specialty selection
- Creating first post: camera → record → publish — no words

> ⚠️ Formats 1, 2, 5 all use style `UGC` + `replicate-wan-t2v` (or `replicate-wan-i2v`
> for image-to-video ASMR). What differentiates them is camera motion, audio flag, and
> prompt content. Format 3 uses `Product Demo` + `replicate-kling`. Format 4 uses
> `App Promo` + `replicate-wan-t2v`.

---

## STAGE 1 — Trend Research & Viral Idea Generation

### Step 0 — Probe Video Studio capability *(internal — execute silently)*

> Send Stage 1 banner FIRST, then run silently:

1. `presets_show()` — cache available styles and camera motions
2. `show_reference_elements()` — cache aspect ratios, durations, modes
3. `show_characters()` — cache character/persona tips for UGC formats

Cache all results. Never show tool names, UUIDs, or "probing" language to the user.

### Step 1 — Auto-identify PingTop context *(silent — no user confirmation needed)*

From the screenshot/logo/URL, auto-derive:
- **Category:** mobile super-app / all-in-one social platform / creator economy
- **Key modules:** social feed · messenger · live streams · service marketplace · AI tools
- **Target audience:** Gen Z / Millennials, entrepreneurs, content creators, freelancers
- **Active styles:** UGC, Product Demo, App Promo, School Viral Reel (primary)

**One user-facing status line (NOT a question):**
> "Got it — this is a next-generation all-in-one platform: social + messenger + service
> marketplace + AI in one app. I'll target [market] and focus on what's going viral in this
> niche right now — challenge-style clips with app demos, live stream highlights, quick expert
> demos, honest feature reviews, and ASMR interface screen recordings."

Then proceed directly to Step 2. No AskUserQuestion at this step.

### Step 2 — Run mandatory trend research *(internal — 8 searches in parallel, silently)*

Replace `[niche]` with "social media app" / "all-in-one platform" / "creator economy app".
Replace `[current month year]` with today's date.

1. `[niche] TikTok trending videos this week [current month year]`
2. `viral [niche] content Instagram Reels [current month year]`
3. `[niche] YouTube Shorts trending [current month year]`
4. `super app brand content going viral [current month year]`
5. `top mobile app ads performing Meta [current month year]`
6. `UGC content trend creator monetization [current month year]`
7. `app launch hooks that stop the scroll [current month year]`
8. `competitor super app social media strategy [current month year]`

A short "Pulling this week's trends…" line is acceptable. No search query list to the user.

### Step 3 — Fetch 2+ source pages *(in parallel)*

`web_fetch` the 2 most useful URLs for specific examples, hook lines, creative patterns.

### Step 4 — Synthesize Viral Content Brief

For every idea, REQUIRED fields:

```
N. [Title]
- Format: [1-5 from the 5 PingTop UGC formats]
- Style: [UGC | Product Demo | App Promo | School Viral Reel | Cinematic | AI Social Platform Ad]
- Model: replicate-wan-t2v | replicate-luma | replicate-kling (internal — do not show to user)
- Duration: 15 seconds (always — no other value)
- Aspect ratio: 9:16 | 1:1 | 16:9
- Camera motion: [Handheld | Zoom in | Dolly in | Orbit | Pan | Static]
- Audio: [true/false — true for ASMR and VO-driven UGC]
- Scene prompt: [≤2 sentences, respects style bounds]
- Social post caption: [line used when uploading to TikTok/IG — NEVER in the video itself]
- Inspired by: [specific trend / competitor from research]
- Why viral now: [specific reason tied to research]
```

**Producibility self-check before adding any idea:**
1. Duration is 15 seconds? If idea needs less, compress it — never use 5s or 10s.
2. Style matches content? (talking-head → Product Demo; challenge/moment → UGC; feature walkthrough → App Promo; premium brand → Cinematic; surreal → AI Social Platform Ad)
3. ~75% of ideas are UGC-family formats (1, 2, 5)?
4. No forbidden patterns (lip-sync, split-screen, multi-character continuity)?

**Brief structure:**
- Trends table · Competitor table
- Hook patterns (verbal VO hooks, NOT camera motion names)
- Format momentum (filtered to producible in Video Studio)
- **Recommended Content Mix** — state the per-format counts as a natural consequence of research
- **15+ seed ideas** — ~75% UGC-family formats 1/2/5, ~25% formats 3/4

### Step 5 — Approval (buttons)

> "Brief is UGC-first and ready to generate. What next?"
> - "Looks good — proceed to Stage 2 (Recommended)"
> - "Add more UGC Challenge ideas"
> - "Add more Service Demo ideas"
> - "Adjust the mix"

---

## STAGE 2 — Video Content Plan

### Step 1 — Confirm campaign details *(single AskUserQuestion, all buttons)*

- Campaign name: "Use auto: PingTop Campaign [Month Year]" / "Different name"
- Date range: "Next 30 days (Recommended)" / "60 days" / "90 days" / "Custom"
- Campaign focus: "Service Marketplace" / "Social Feed" / "AI Tools" / "All equally"

Do NOT ask about format breakdown — computed silently as `floor(VIDEO_COUNT / 5)`.

### Step 2 — Generate HTML Video Content Plan

[VIDEO_COUNT] rows. Every row:

`#` · `Date` · `Format (1–5)` · `Style` · `Duration` · `Aspect Ratio` · `Camera Motion` ·
`Audio` · `Scene Prompt` · `Social Post Caption (metadata only — never in video)` · `Goal`

**Row grouping order:** UGC Challenge → Live Announce → Service Demo → Feature Review → ASMR Screen

Within each format, vary concept seeds so no two videos in the same format are identical.
Distribute dates evenly — interleave formats day-to-day.

### Step 3 — Save the plan

Save to `/mnt/user-data/outputs/pingtop-video-plan.html`

Present the plan + button: "Proceed to Stage 3 — Generate Videos"

---

## STAGE 3 — Generate Content

> ⚠️ CRITICAL: Ask permission before EACH format batch. Never auto-run the full plan.

### Step 1 — Build PingTop reference library *(show status line, then run silently)*

**Status line to user:** "Getting your PingTop visuals ready…"

**1a — Register main brand image (`pingtop_logo`):**
If user provided a URL: `media_import_url(url, type='image')` →
store as `REFERENCE_LIBRARY['pingtop_logo']`.
If user attached a file: ask them to share a public image URL.

**1b — Scan the full content plan for feature slugs needed:**
Auto-detect all unique feature slugs across every planned video/image using the keyword
table in the PINGTOP UI REFERENCE LIBRARY section. Build a deduplicated list.

**1c — Pre-collect missing references (once per unique slug, before generation starts):**
For each feature slug not yet in `REFERENCE_LIBRARY`, run the reference check protocol
from the PINGTOP UI REFERENCE LIBRARY section. Collect all unknown slugs in ONE
AskUserQuestion if multiple are missing — do not ask one-by-one.
If user has no reference for a slug, mark it as `null` — fall back to `pingtop_logo`.

### Step 2 — Resolve styles and camera motions *(internal — silently)*

Use cached results from Stage 1 Step 0. Map each plan row to:
- `style` → from Style column
- `camera_motion` → from Camera Motion column
- `model` → from Format definition (internal)
- `reference_image_url` → the registered PingTop image URL

### Step 3 — Per-batch permission gates (REQUIRED — never skip)

Process in this order:

| Batch | Format | Style | Model | Camera |
|---|---|---|---|---|
| 1 | UGC Challenge | UGC | replicate-wan-t2v | Handheld |
| 2 | Live Announce | UGC | replicate-wan-t2v | Zoom in |
| 3 | Service Demo | Product Demo | replicate-kling | Dolly in |
| 4 | Feature Review | App Promo | replicate-wan-t2v | Static |
| 5 | ASMR Screen | School Viral Reel | replicate-wan-i2v | Static |

Before EACH batch, AskUserQuestion:

> "Ready to generate **[N] [Format name]** videos? (9:16, [duration]s, audio [on/off])"
> - "Yes — generate all [N]"
> - "Start with 3 for a quality check (Recommended)"
> - "Skip this batch for now"
> - "Change settings before generating"

After each batch → `get_video_status(generation_id)` for each job → show results →
button: "Generate next batch" / "Re-do this batch" / "Pause"

### Step 4 — Prompt template for each video *(internal — never narrate structure)*

Every prompt MUST be structured as timed acts so the idea is complete within the clip —
never cut off mid-thought. Choose the template matching the video's duration:

**All videos are 15 seconds. Use this template every time:**

```
[0–5s HOOK — visual + spoken line]
Visual: [Action that instantly grabs attention — person's face, phone reveal, unexpected
moment. Stop the scroll visually.]
Character says out loud: "[Bold opening line — a surprising fact, provocative question,
or strong claim about PingTop. Examples: 'I replaced 5 apps with one.' / 'This app paid
me $200 in a week.' / 'Why are you still using WhatsApp?']"

[5–10s CORE — visual + spoken line]
Visual: [PingTop feature clearly on screen — the specific UI from reference image visible,
interaction happening, benefit demonstrated.]
Character says out loud: "[Name the exact feature and its specific benefit. Examples:
'One tap — I'm live streaming to 500 people on PingTop.' / 'Expert marketplace: I booked
a lawyer for $7.' / 'The AI summarized my 2-hour meeting in 30 seconds.']"

[10–15s PAYOFF — visual + spoken line]
Visual: [Reaction, result, or decisive close — smile, transformation, app confirmation
screen, or user's satisfied expression. Idea must feel 100% complete here.]
Character says out loud: "[Memorable closing line — result or CTA. Examples: 'PingTop.
Everything in one place.' / 'Download it — your first expert session is free.' /
'I'm never going back.']"

Platform: PingTop — [key visual detail from reference image: UI color, feature name,
screen element visible].
Style cues: [UGC → "authentic handheld, natural light, real-person energy, casual speech";
Service Demo → "professional, confident tone, expert authority, polished look";
ASMR → "soft whispered VO only, intimate close-up, slow deliberate taps, no music"].
generate_audio: true
Negative: no text overlay, no captions, no subtitles, no on-screen text, no watermarks,
no lower-third, no graphic banners. Clean visual only.
```

**Before building the prompt:** run the Reference Check Protocol from the PINGTOP UI
REFERENCE LIBRARY section to set the correct feature screenshot as `reference_image_url`.

The social post caption is NEVER included in the video prompt — it lives in plan metadata only.

### Step 5 — Image asset pack *(after all video batches)*

**Image count = `floor(VIDEO_COUNT / 5)`**
Breakdown: 40% Social · 20% Hero Banner · 20% With-People · 20% Without-People

| Videos | Images | Social | Hero | With-people | Without-people |
|---|---|---|---|---|---|
| 50 | 10 | 4 | 2 | 2 | 2 |
| 100 | 20 | 8 | 4 | 4 | 4 |
| 150 | 30 | 12 | 6 | 6 | 6 |
| 200 | 40 | 16 | 8 | 8 | 8 |

AskUserQuestion gate:
> "Videos done. Ready to generate the image asset pack — [N] images?"
> - "Yes — generate all [N] (Recommended)"
> - "Yes — skip with-people shots"
> - "Yes — only without-people shots"
> - "Skip image pack"

**Generation (internal — using `generate_image` tool):**
- Social posts (1:1): PingTop interface stylizations, user-with-phone moments, "wow" feature moments
- Hero banners (16:9): lifestyle with app, expert at laptop, two users collaborating
- With-people shots: diverse demographics, users in chat, expert + client in video call
- Without-people shots: smartphone on neutral background, app icon, interface close-up

**Before generating each image:** run the Reference Check Protocol to detect the
feature slug from the scene description and retrieve the matching reference URL.
Pass it as `reference_image_url` for brand UI authenticity.

Prompt per image:
```
[Scene description]. Platform interface: PingTop [color palette from reference screenshot,
logo visible, real UI element if reference provided].
Style: [social=lifestyle authentic; hero=polished editorial; people=diverse real-feel;
no-people=minimal clean].
Negative: no text, no captions, no watermarks, clean image.
```

Use `quality: "fast"` (Replicate FLUX Schnell) by default.
Use `quality: "high"` (Replicate FLUX Dev) only if user explicitly requests premium quality.

Save to `/mnt/user-data/outputs/pingtop-asset-pack/` with descriptive names.

**Failure handling:** log failed generation IDs → AskUserQuestion: "Retry" / "Skip" / "Pause"

---

## STAGE 4 — Scheduling Calendar

### Step 1 — Meta MCP connection check

AskUserQuestion:
> "Before scheduling — is your Meta Ads MCP connected?"
> - "Yes — Meta MCP connected (Recommended)"
> - "Not connected — help me set it up"
> - "Skip live scheduling — give me an export calendar"

**If "Skip":** export `pingtop-content-calendar.csv` with columns:
Date · Time · Format · Style · Video filename · Image filename · Social caption · Goal · Notes
Save to `/mnt/user-data/outputs/` → proceed to Stage 5.

**If "Not connected":** explain setup path (Settings → Connections → Meta Ads).

**If "Yes":** proceed to Step 2.

### Step 2 — Campaign details (single AskUserQuestion)

- Objective: "Awareness" / "Traffic" / "Conversions" / "Mixed"
- Budget: "$500" / "$1,500 (Recommended)" / "$5,000" / "Custom"
- Dates: "Match content plan (Recommended)" / "Next 30 days" / "Custom"

### Step 3 — Calendar review → schedule

Present calendar → AskUserQuestion "Schedule looks good?":
"Yes — schedule everything" / "Start with week 1 only" / "Adjust dates first"

### Step 4 — Confirm

AskUserQuestion: "Scheduling done — continue to Stage 5?"
"Yes — cost report (Recommended)" / "Pause" / "Generate more content" / "Skip Stage 5"

---

## STAGE 5 — Cost Comparison Report

### Step 1 — Pull actual spend

`transactions(limit=200)` → filter to Stage 3 generation window → sum credits by style/model
→ convert to USD at approximate rates:
- replicate-wan-t2v / replicate-wan-i2v → ~$0.05/video (Replicate WAN)
- replicate-luma → ~$0.08/video
- replicate-kling → ~$0.12/video
- generate_image (Pollinations) → $0.00 (free)
- generate_image (FLUX Dev) → ~$0.03/image

### Step 2 — Traditional production cost model (2026 industry averages)

| Asset type | Low (USD) | Mid (USD) | High (USD) |
|---|---:|---:|---:|
| UGC challenge video (TikTok/Reels) | 250 | 750 | 1,500 |
| Live announce / stream highlight clip | 200 | 600 | 1,200 |
| Service demo / talking-head video | 300 | 900 | 2,000 |
| App feature review video | 250 | 700 | 1,500 |
| ASMR screen recording (produced) | 150 | 500 | 1,000 |
| Social post (lifestyle 1:1) | 100 | 250 | 500 |
| Hero banner (16:9) | 500 | 1,500 | 3,000 |
| With-people photo shoot | 500 | 1,500 | 3,000 |
| Without-people product shoot | 200 | 700 | 1,500 |

Time savings:

| Channel | Video Studio | Traditional |
|---|---|---|
| 100 mixed videos | 2–4 hours rendering | 6–12 weeks production |
| Image asset pack | 5–15 minutes | 1–3 weeks (shoot + retouch) |
| Scheduling | Minutes | Days of manual trafficking |

### Step 3 — Generate HTML report

Save to `/mnt/user-data/outputs/pingtop-cost-comparison.html`

Required sections:
1. **Hero card** — "PingTop Campaign: delivered for $X instead of $Y–$Z. Saved N% and W weeks."
2. **Volume summary** — total videos and images created
3. **Video Studio spend** — credits by format + USD
4. **Traditional cost** — same volumes at low/mid/high rates
5. **Comparison bars** — horizontal HTML/CSS bars (no external libraries)
6. **Time savings** — side-by-side table
7. **Methodology** — industry-average estimates 2026, USD

Visual style: PingTop brand colors (extracted from logo/screenshot).
Header: "[Campaign Name] — Cost Comparison Report"

### Step 4 — Final buttons

AskUserQuestion:
> "Report is ready. What next?"
> - "Close the pipeline (Recommended)"
> - "Generate more content for PingTop"
> - "Adjust cost rates and recalculate"
> - "Run the pipeline for a different PingTop campaign"

---

## GLOBAL RULES (hard constraints)

1. **Buttons only (HARD):** every clarifying question → AskUserQuestion with 2–4 buttons. No free-form navigation.
2. **No pauses:** all clarifying questions in one call. No sequential drip-asking.
3. **5-format split (HARD):** always `floor(VIDEO_COUNT / 5)` per format. Remainder starts at Format 1.
4. **Producibility:** every idea must work in Video Studio at 5/10/15s, OR be explicitly labeled "Outside Video Studio."
5. **Batch gates (Stage 3):** always ask before generating. Never auto-run the full plan.
6. **No on-screen text ever:** captions, subtitles, watermarks, lower-thirds, banners — all forbidden in video prompts. Captions belong in social metadata only.
7. **Stage transitions via buttons:** every stage ends with an AskUserQuestion transition to the next.
8. **Feature-specific UI references:** detect which PingTop feature appears on screen, check
   `REFERENCE_LIBRARY`, ask once per unique slug per batch (not per video). Always use real
   screenshots over AI-invented UI. Apply to both videos and images.
9. **Reference reuse buttons:** when a saved reference exists, always offer "Use saved ✓"
   and "Send new one" — never silently reuse without showing the user the option.
10. **15s with 3-act VO structure (HARD):** every video is 15s. Every prompt MUST include
    three acts — [0–5s HOOK + spoken line], [5–10s CORE + spoken line], [10–15s PAYOFF +
    spoken line]. No vague single-sentence prompts. Characters always speak about PingTop.
    `generate_audio: true` on every single video — no exceptions.
11. **Error handling:** log failed job IDs → buttons "Retry / Skip / Pause".
12. **Language:** user-facing text = plain English, no tool names, no UUIDs, no parameter names.
