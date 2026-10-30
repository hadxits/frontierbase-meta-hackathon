<div align="center">

<h1><img src="docs/assets/frontierbase-logo.png" width="48" height="48" alt="FrontierBase logo" /> FrontierBase</h1>

**From support spreadsheets to voice menus.**

Meta Muse groups your FAQs, writes the spoken answers, and keeps the policy details together.

`Meta Muse Spark 1.3` · `Console: Vue 3` · `Widget: JavaScript (Vite)` · `Node.js 22` · `Firebase` · `ElevenLabs`

[Website](https://www.frontierbase.io) · [Product experience](#product-experience) · [Architecture](#system-architecture) · [Results](#results)

<img src="docs/assets/frontierbase-hero.png" width="1280" alt="FrontierBase illustrated knowledge workshop: spreadsheet and policy knowledge becomes conversations and guided support. Your knowledge. A clear way forward." />

**Meta Global AI Developer Hackathon 2026**

</div>

**FrontierBase turns business spreadsheets and documents into a knowledge base for AI customer support.**

![FrontierBase uses the same business knowledge for existing AI chat and new Muse-powered voice menus](docs/assets/platform-overview.svg)

## A Return Policy Customers Can Follow

Consider a store that accepts return requests within **30 days of delivery**.\
After approval, the customer has **14 days from label issue to mail the parcel**, even if the original return window has ended.\
Both deadlines matter.

In our apparel-store example, those rules were spread across six FAQs.\
Muse brought them into one return guide, together with eligibility, label fees and mailing instructions.\
Damaged items, manufacturing defects and lost return parcels each had their own menu item.

![Six apparel-store FAQs combined into a return guide that retains both deadlines](docs/assets/ars-proof.svg)

The full example turned **60 FAQs into 8 main choices and 46 answers**.\
Each answer remains linked to the source rows used to write it.

## Product Experience

**Connect knowledge → generate a draft → inspect its evidence → review and publish.**

Operators upload their support knowledge, check the generated menu and answers, and publish when ready.\
Customers choose the issue they need help with and hear the relevant guidance.

### #img1 — Generated menu

![Screenshot placeholder: generated menu with return, exchange and refund branches expanded](docs/assets/capture-img1.svg)

### #img2 — Answer review

![Screenshot placeholder: return answer showing the 30-day request and 14-day mailing deadlines](docs/assets/capture-img2.svg)

### #img3 — Customer experience

![Screenshot placeholder: customer widget with a selected return option and its answer](docs/assets/capture-img3.svg)

## The Problem

Small businesses already keep answers in spreadsheets and documents.\
Building a voice-support menu means working through that material again: deciding where each question belongs, writing scripts and checking the exceptions.\
When a policy changes, someone has to update the menu too.

FrontierBase uses Muse to do the drafting.\
Staff keep control of what gets published, with the source material available for checking each answer.

## What Changed

During development, we ran the original ARS generator and the Muse pipeline on the same five test cases, containing 62 source rows.\
These examples show the differences we observed:

| Case | Original ARS generator | Muse pipeline |
| :--- | :--- | :--- |
| A refund exception buried in a long policy | Left out the restriction on refunds after bonus credits were used. | Retained that restriction in the refund guidance. |
| One FAQ covering email changes and receipt downloads | Put both instructions under one email-change menu item. | Created separate destinations for the two tasks. |
| Two return deadlines for the same product | Generated both versions without a conflict flag. | Brought the deadlines together and marked the answer for staff review. |

This gives a business a support flow it can review and publish: questions are routed by purpose, answers retain relevant policy details, and staff can inspect the sources behind them.\
The comparison covers these selected cases; it is separate from the apparel-store example above.

## How We Use Meta AI

Muse Spark 1.3 handles four steps:

1. **Read the source.** Identify questions, conditions and exceptions in each row.
2. **Design the menu.** Group related questions by what the customer wants to do, then review the routes.
3. **Connect the evidence.** Assign source passages to each menu item.
4. **Write the answers.** Use the assigned material to produce spoken guidance and flag anything that needs review.

Muse builds the menu and writes the answers.\
FrontierBase keeps the source material attached, gives staff a draft to review, and publishes the approved content through its existing voice-support experience.

The menu is generated from the business’s own material.\
There is no fixed list of store categories or row-by-row routing rules.

## Staff Stay in Control

Each answer is linked to the policies used to write it.\
Staff can check the wording, make corrections and decide when it is ready for customers.

When Muse identifies conflicting policies, it keeps the disagreement visible for a staff member to resolve.\
Flagged answers cannot be published until that review is complete.\
Customers then navigate the published answers, while staff retain the source material for future updates.

## System Architecture

The admin console uses **Vue 3**. The customer widget is written in **JavaScript** and built with **Vite**. The backend runs on **Node.js 22 and Firebase**, with **Muse** for menu generation and **ElevenLabs** for speech.

![Existing conversational requests and new asynchronous Muse generation share the knowledge foundation](docs/assets/architecture.svg)

Menu generation runs in the background, with progress available to the operator.\
Drafts stay separate from published content.\
The existing ElevenLabs integration provides speech playback.

## Built for the Meta Global AI Developer Hackathon

| Existing foundation | Hackathon contributions |
| :--- | :--- |
| Spreadsheet ingestion, Qdrant retrieval, conversational clarification and state | Separate Muse generation API and private worker |
| ARS prototype, review, publishing and speech | Customer-goal planning, plan review and full-evidence answers |
| Tenant authentication and support escalation | Source mapping reports, stale-write protections and local evaluation |

Project history: [FrontierBase baseline · 77c2d10](https://github.com/hadxits/frontierbase-meta-hackathon/commit/77c2d100a5d91dcbbb7816aa923b88f2375b3091) → [initial hackathon implementation · ccbcb3a](https://github.com/hadxits/frontierbase-meta-hackathon/commit/ccbcb3a86fe5f9e44a2b55b4686bc1dcbb631c31).

For [Build for Your World](https://dev.meta.ai/events/global-hackathon), we focused on a familiar problem: helping a small business put its existing support knowledge to work.

## Results

**Apparel-store evaluation · October 28, 2026**

- **60/60 rows linked**, 8 top-level choices, 46 answer destinations.
- **14/14 targeted policy phrase checks passed** in answers linked to the relevant sources.
- **35/35 backend regression tests passed.**
- **4 minutes 30 seconds** to generate the menu and answers for this sample.

Test scope: a synthetic 60-row dataset, selected policy phrase checks and mocked backend regression tests.\
Deployed playback and audio quality are the next validation steps.

## Key Implementation Files

- [Muse integration](cloud%20functions/utils/arsMuseLlm.js) — calls Meta’s model and validates its responses.
- [Menu generation](cloud%20functions/utils/arsMuseGenerator.js) — organizes questions, connects source passages and writes answers.
- [Draft review](cloud%20functions/endpoints/ai/updateArsLeafReview.js) and [publication](cloud%20functions/endpoints/ai/publishArsMenu.js) — let staff edit answers, resolve review flags and publish.
- [Generation jobs](cloud%20functions/utils/arsMuseJobs.js) — manage background work and keep each draft tied to its source.

## What Comes Next

Next we’re testing the complete published voice flow, shortening longer answers and evaluating more business datasets.\
The longer-term goal is straightforward: when a business updates its policies, updating customer support should be just as manageable.
