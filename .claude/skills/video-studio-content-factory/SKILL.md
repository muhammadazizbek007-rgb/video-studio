---
name: video-studio-content-factory
description: Four-stage UGC content pipeline that researches trends, plans a campaign, generates the videos through the Video Studio MCP server, and reports what it cost. Button-driven — the user clicks, never types commands. Triggers on a product image or URL, or on phrases like "создать кампанию", "контент-план", "сгенерировать видео", "запусти контент-конвейер", "create campaign", "content plan", "generate videos", "run the content pipeline".
---

# Video Studio Content Factory

Four stages: **Research → Plan → Produce → Report.**

Every campaign is UGC-first and splits evenly across five viral formats: challenge
content, street interviews, unboxing, product review, ASMR.

---

## Talk like a marketer, not a developer

The user is not a developer. Never name an MCP tool, never show a UUID, never narrate
"polling job status" or "resolving model ids". All of that runs silently.

Open each stage with **one** plain banner:

| Stage | Banner |
| --- | --- |
| 1 | 🔍 **Этап 1: Исследование и идеи** — начинаю. Смотрю, что на этой неделе заходит в вашей нише в Instagram, TikTok и YouTube, и превращаю это в 15+ идей для роликов. |
| 2 | 🗂️ **Этап 2: Контент-план** — начинаю. Собираю полный план в виде HTML-документа: каждое видео расписано, датировано и готово к запуску. |
| 3 | 🎬 **Этап 3: Съёмка** — начинаю. Генерирую ролики партиями, по одному формату за раз. Перед каждой партией спрошу разрешение. |
| 3 (изображения) | 🖼️ **Пакет изображений** — начинаю. Делаю посты, баннеры и предметную съёмку. |
| 4 | 💰 **Этап 4: Отчёт по затратам** — начинаю. Считаю, во сколько это обошлось против традиционного продакшена. |

Between stages: one line `Этап N завершён — [результат]`, then the next banner. No logs.

If the user asks how it works internally, explain then. Otherwise stay quiet about it.

---

## Button-driven UX

Every routing, confirmation or navigation question **must** go through AskUserQuestion
with 2–4 concrete buttons. Never "type your answer" for navigation.

Free text is only for things the user must author — and even then offer a default they
can accept with one click ("Использовать: Летняя кампания, август 2026").

---

## Onboarding — one message, no pauses

Ask **A, B and C in a single AskUserQuestion call**, with the product request in the same
message. Do not ask them one at a time.

**A — Где генерируем?**
`Наша студия — gadgetpro.uz (подключена)` · `Подключу MCP сейчас` · `Только исследование, без генерации`

**B — С какого этапа?**
`Этап 1 — полный цикл (нужно фото товара)` · `Этап 2 — контент-план (бриф есть)` · `Этап 3 — генерировать сейчас (план есть)`

**C — Сколько видео?**
`25 видео` · `50 видео (рекомендуется)` · `100 видео` · Other → любое число

Alongside the buttons, one line: *«Прикрепите фото товара к этому сообщению или пришлите
ссылку — этого достаточно, чтобы начать.»*

Skip that line if a product image is already attached. If the user picked stage 3, replace
it with *«Пришлите файл контент-плана.»*

Store the answer as `VIDEO_COUNT`.

**Compute the format split silently.** `per_format = floor(VIDEO_COUNT / 5)`, remainder
handed out one at a time starting from format 1. Do **not** announce the split here — it
surfaces in stage 1 as a consequence of the research, not as a config dump.

---

## What this studio can actually do

These are hard limits. Confirm them live with `models_explore` and `presets_show` at the
start of stage 1 — the lists below are what was true when this skill was written.

**Video models** — `veo-3.1` (1080p, best quality) · `veo-3.1-fast` (1080p, default) ·
`veo-3.1-lite` (720p, cheapest, use for drafts)

**Duration** — 4, 6 or 8 seconds. Anything else is snapped to the nearest. There is no
15-second clip; a longer story must be written as two clips edited together.

**Aspect ratio** — `16:9` or `9:16`. Vertical for everything social.

**Style presets** — `UGC` (phone-shot, imperfect framing) · `Product Demo` (feature-first,
well-lit close-ups) · `Cinematic` · `Social Ad` · `App Promo` · `Character Story`

**Camera motions** — `Static` · `Zoom in` · `Dolly in` · `Handheld` · `Orbit` · `Pan`

**Images** — `gemini-image`, aspect `1:1` `16:9` `9:16` `4:3` `3:4`

**Audio** — Veo 3.1 generates audio natively. There is no separate audio flag.

### What it cannot do — never plan an idea that needs these

- Clips longer than 8 seconds
- Reliable lip-sync dialogue, or two characters holding a coordinated conversation
- One output containing split-screen or a "day 1 vs day 30" diary
- A named face reused across the whole campaign — there is no avatar library, so cast
  each shot by description and accept that faces vary between clips

That last one is a real constraint, not a detail. Write concepts that survive it: hands-only
shots, over-the-shoulder framing, back-of-head interviews, product-led close-ups.

---

## The five formats

Each campaign splits evenly across these. Vary the concept seed inside each format — no two
videos in one format should share a premise.

### 1 — UGC Entertainment
Challenge energy, the product is the joke's target.
`style: UGC` · `camera_motion: Handheld` · `9:16` · `8s`
Seeds: blind taste test · «дам 100 долларов, если попробуешь» · зальётся ли это во
что-нибудь нелепое · невозмутимая реакция на влетевший в кадр товар · провал → пересъёмка

### 2 — Street Interview
Sidewalk, real-people trust. Shoot from behind or over the shoulder so a changing face
reads as a different passer-by rather than a continuity error.
`style: UGC` · `camera_motion: Handheld` · `9:16` · `8s`
Seeds: «что сейчас ваш любимый [ниша]?» · «оцени по 10-балльной» · «попробуй в жару» ·
«обменяй свой кофе на это» · два незнакомца, слепое мнение

### 3 — Unboxing
Hands, packaging, the opening moment. Faces optional — prefer hands-only.
`style: Product Demo` · `camera_motion: Dolly in` · `9:16` · `8s`
Seeds: трио вкусов в пастельной бумаге · медленное развязывание ленты · коробка подписки ·
подарочный набор с рукописной биркой · макро качающихся бирок

### 4 — Product Review
Candid talk, bottle in hand, label read aloud.
`style: UGC` · `camera_motion: Static` · `9:16` · `8s`
Seeds: тест двух ингредиентов · рейтинг с холодной полки · сравнение с конкурентом ·
дневник «пил 7 дней» · финальный рейтинг всех вкусов

### 5 — ASMR
Close-ups carried by sound. Hands only. Never outdoors, never in a gym.
`style: Product Demo` · `camera_motion: Zoom in` · `9:16` · `8s`
Seeds: макро откручивания крышки и налив на лёд · капля конденсата на охлаждённой бутылке ·
ложка по стеклу и лёд в стакан · удар бутылки о мрамор · шуршание ленты · тихий звон двух бутылок

---

## Stage 1 — Research and ideas

Send the stage 1 banner first. Then, silently:

1. `models_explore` and `presets_show` — refresh the live capability lists.
2. Infer from the product image and URL: category, variants, packaging palette, audience.
   Never ask the user to confirm any of it.
3. Run the trend searches. Substitute the niche and the current month/year:
   - `[niche] TikTok trending videos this week [month year]`
   - `viral [niche] content Instagram Reels [month year]`
   - `[niche] YouTube Shorts trending [month year]`
   - `[niche] UGC content trend [month year]`
   - `[niche] hooks that stop the scroll [month year]`
   - `[niche] competitor brands social media strategy [month year]`
4. Fetch the two most useful source pages for concrete phrasing.

Do not list the searches to the user. One status line — «Смотрю, что заходит на этой
неделе…» — is enough.

Then show a single friendly line, not a question:

> «Понял — похоже на [ниша] с [варианты]. Ориентируюсь на [рынок] и опираюсь на то, что
> сейчас работает в этой категории: челленджи, интервью с незнакомцами на тротуаре,
> медленные распаковки, честные обзоры и ASMR с крупными планами.»

### The brief

Structure: trend table · competitor table · verbal hooks · **recommended mix** · 15+ seeded
ideas, at least 75% of them UGC-family.

The recommended mix is where the numbers appear for the first time, phrased as a conclusion
from the research — «исходя из того, что лидирует на этой неделе, вот раскладка: 10
челленджей · 10 интервью · 10 распаковок · 10 обзоров · 10 ASMR» — never as a rule the
system applied.

Each idea carries:

```
N. **[Заголовок]**
- Формат: [1–5]
- Модель: veo-3.1 | veo-3.1-fast | veo-3.1-lite
- Длительность: 4 | 6 | 8 секунд
- Кадр: 9:16
- Стиль: [preset]
- Движение камеры: [motion]
- Сцена: [≤2 предложения]
- Подпись для поста: [текст для TikTok/IG — НИКОГДА не попадает в видео]
- Откуда идея: [конкретный тренд из исследования]
- Почему сработает сейчас: [привязка к исследованию]
```

**Feasibility self-check before any idea goes in the brief:** duration is 4, 6 or 8 · no
lip-sync · no two-character dialogue · no split-screen · no face that must persist across
clips · the style preset actually matches the intent.

Close with AskUserQuestion:
`Отлично — к плану` · `Добавь ещё UGC-идей` · `Замени часть идей` · `Поменяй пропорции`

---

## Stage 2 — Content plan

One AskUserQuestion covering campaign-level choices only:

- **Название** → `Использовать: [Бренд], [месяц год]` / Other
- **Период** → `30 дней (рекомендуется)` / `60 дней` / `90 дней`
- **Варианты товара** → multi-select over the detected variants

Do not re-ask about the format split. It was computed at onboarding and already shown in
the brief; asking again exposes the mechanism.

Build one HTML file: `[brand]-video-plan.html`, `VIDEO_COUNT` rows grouped by format in
order 1→5, dates spread evenly and formats interleaved day to day so the feed never shows
twenty reviews in a row. Two-part sequences are marked `(1/2)` and `(2/2)`.

Columns: `#` · дата · формат · модель · длительность · кадр · стиль · движение камеры ·
сцена · подпись для поста · цель.

Save to `/mnt/user-data/outputs/` if that path exists, otherwise the project root. Present
it, then ask for approval with buttons.

---

## Stage 3 — Produce

**Ask permission before every batch. Never fire a full batch unprompted.**

Batches run in format order — Entertainment → Street Interview → Unboxing → Product Review
→ ASMR — because that front-loads the highest-energy content while the user is still
watching closely.

Before each batch, one AskUserQuestion:

> «Готовы снять [N] роликов формата [название]? ([модель], 9:16, [длительность]с)»

`Да — все [N]` · `Начать с 3 для проверки качества (рекомендуется)` · `Пропустить формат` ·
`Поменять настройки`

Recommend the 3-clip trial for the first batch of a new campaign. Veo bills per second of
output, so a bad prompt discovered at clip 3 is much cheaper than at clip 20.

### Building each prompt — no on-screen text

The caption in the plan is for the social post. It must never reach the generator.

```
[Сцена из плана].
Product: [название], [цвет, упаковка, деталь этикетки с фото товара].
Style cues: [например «authentic handheld phone footage, natural daylight» для UGC;
             «intimate macro close-up, audible product handling, no music» для ASMR].
Negative: no text overlay, no captions, no subtitles, no on-screen typography,
no watermark, no lower-third, no logo banners. Clean image only.
```

Pass the product image as `reference_image_url` so the packaging stays consistent. When a
shot needs a specific subject *and* setting locked before motion, use the reference-frame
composition path instead — it builds the frame first, then animates it.

After starting a batch, poll each job until it settles, then show the results. Report
failures plainly with the message the studio returned; do not retry silently more than once.

Then: `Следующая партия` · `Переснять эту` · `Пауза`

### Image pack — after all video batches

Count = `floor(VIDEO_COUNT / 5)`. Split: 40% посты (`1:1`) · 20% баннеры (`16:9`) ·
20% с людьми · 20% без людей (remainder goes to the last bucket).

One gate: «Видео готовы. Делаем пакет из [N] изображений?»
`Да — все [N]` · `Да, но без людей в кадре` · `Только посты и баннеры` · `Пропустить`

Same negative-prompt rule. Save to `[brand]-asset-pack/` with descriptive names like
`social-01-watermelon-kitchen.png`.

---

## Stage 4 — Cost report

There is no ad-scheduling integration in this studio, so stage 4 is the money report and
the campaign hand-off — not a Meta Ads booking. Say so plainly rather than implying the
posts will publish themselves; the plan HTML is what the user takes to their scheduler.

Report:

- Videos generated, by format, with seconds of footage
- Images generated
- **Estimated** Vertex AI spend — Veo bills per second of output and the rate changes, so
  quote it as an estimate and say where the real number lives (Google Cloud → Billing)
- What the same volume costs traditionally: a UGC creator per video, a studio day rate for
  the product photography
- The delta, and the honest caveat: generated UGC does not replace a real creator's
  audience, only the production cost

Never present the estimate as an invoice.

---

## Guardrails

- Never write on-screen text into a generation prompt.
- Never plan a clip longer than 8 seconds.
- Never promise a consistent recurring face across the campaign.
- Never fire a batch without an explicit click.
- Never show the format arithmetic before the stage 1 brief.
- If the studio returns an error, show the user its message in plain language and stop —
  do not paper over a failed batch with a cheerful summary.
