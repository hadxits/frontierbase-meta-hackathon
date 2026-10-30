<div align="center">

<h1><img src="docs/assets/frontierbase-logo.png" width="48" height="48" align="middle" alt="FrontierBase logo" /> FrontierBase</h1>

**From support spreadsheets to voice menus.**

Meta Muse turns your FAQs into voice menus, checks the routes and policy details, and repairs the draft before staff review.

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

In our apparel-store example, Muse connected seven source rows into one return guide: eligibility, the return procedure, label fees, printing alternatives, mailing deadlines and support options.\
Wrong or damaged items, suspected manufacturing defects and stalled return parcels had separate destinations.

![Seven apparel-store source rows support a return guide that retains both deadlines](docs/assets/ars-proof.svg)

The latest deployed run turned **60 FAQs into 6 main choices and 55 answers**, covering **65 extracted customer intents**.\
Each intent has one primary destination; supporting policies can be reused across answers.

## Product Experience

**Connect knowledge → generate and check → review the draft → publish.**

Operators upload their support knowledge. Muse builds the menu, checks its routes and answers, and repairs detected issues.\
Staff inspect the draft and its evidence before publishing. Customers choose an issue on the phone keypad and hear the published guidance.

### #img1 — Generated menu

![Screenshot placeholder: generated menu with return, exchange and refund branches expanded](docs/assets/capture-img1.svg)

### #img2 — Answer review

![Screenshot placeholder: console answer review showing Start and send a return with both deadlines](docs/assets/capture-img2.svg)

### #img3 — Customer experience

![Screenshot placeholder: customer widget in phone mode with its keypad and voice playback indicator](docs/assets/capture-img3.svg)

## The Problem

Small businesses already keep answers in spreadsheets and documents.\
Building a voice-support menu means working through that material again: deciding where each question belongs, writing scripts and checking the exceptions.\
When a policy changes, someone has to update the menu too.

FrontierBase uses Muse to do the drafting.\
Staff keep control of what gets published, with the source material available for checking each answer.

## What Changed

In an earlier comparison, we ran the original ARS generator and the Muse pipeline on the same five test cases, containing 62 source rows.\
These examples show the differences observed in that comparison:

| Case | Original ARS generator | Muse pipeline |
| :--- | :--- | :--- |
| A refund exception buried in a long policy | Left out the restriction on refunds after bonus credits were used. | Retained that restriction in the refund guidance. |
| One FAQ covering email changes and receipt downloads | Put both instructions under one email-change menu item. | Created separate destinations for the two tasks. |
| Two return deadlines for the same product | Generated both versions without a conflict flag. | Brought the deadlines together and marked the answer for staff review. |

This gives a business a support flow it can review and publish: questions are routed by purpose, answers retain relevant policy details, and staff can inspect the sources behind them.\
The comparison covers these selected cases; it is separate from the apparel-store example above.

## How We Use Meta AI

Muse Spark 1.3 handles five steps:

1. **Extract customer intents.** Capture the customer’s goal, starting situation, resolution and policy requirements, with exact source quotes.
2. **Design the menu.** Group requests by the outcome the customer needs, then review the proposed routes.
3. **Connect the evidence.** Give each intent one primary destination and reuse supporting facts where needed, including conditions defined in other rows.
4. **Write the answers.** Preserve the relevant fees, eligibility, deadlines and exceptions in spoken guidance.
5. **Audit and repair.** In separate Muse calls, test menu selection from the spoken labels and check answers against their source requirements. Repair affected destinations, then check again, for up to two repair rounds.

Muse creates and checks a support flow before customers use it.\
FrontierBase verifies source quotes and audit excerpts, keeps the evidence attached, and publishes the reviewed content through its existing voice-support experience.\
Customer keypresses navigate those published answers.

The menu is generated from the business’s own material.\
There is no fixed list of store categories or row-by-row routing rules.

## Staff Stay in Control

Each answer is linked to the policies used to write it.\
Staff can check the wording, make corrections and decide when it is ready for customers.

Conflicting policies, missing evidence and unresolved audit findings remain visible in the draft and block publication.\
Editing an answer cannot clear a structural routing blocker; the affected menu must also be corrected.\
A completed generation job means a draft is available, not that it has been published.

## System Architecture

The admin console uses **Vue 3**. The customer widget is written in **JavaScript** and built with **Vite**. The backend runs on **Node.js 22 and Firebase**, with **Muse** for menu generation and **ElevenLabs** for speech.

![Existing conversational requests and new asynchronous Muse generation share the knowledge foundation](docs/assets/architecture.svg)

Menu generation, audits and repairs run in a private background worker, with progress available to the operator.\
Cloud Storage holds the draft and its evidence report; Firestore tracks job ownership and publication state.\
Drafts stay separate from published content. The existing ElevenLabs integration provides speech playback.

## Built for the Meta Global AI Developer Hackathon

| Existing foundation | Hackathon contributions |
| :--- | :--- |
| Spreadsheet ingestion, Qdrant retrieval, conversational clarification and state | Separate Muse generation API and private worker |
| ARS prototype, review, publishing and speech | Structured intent extraction, cross-row policy binding and source-grounded answers |
| Tenant authentication and support escalation | Route and answer audits, scoped repairs, publication blockers and stale-write protections |

Project history: [FrontierBase baseline · 77c2d10](https://github.com/hadxits/frontierbase-meta-hackathon/commit/77c2d100a5d91dcbbb7816aa923b88f2375b3091) → [initial hackathon implementation · ccbcb3a](https://github.com/hadxits/frontierbase-meta-hackathon/commit/ccbcb3a86fe5f9e44a2b55b4686bc1dcbb631c31).

For [Build for Your World](https://dev.meta.ai/events/global-hackathon), we focused on a familiar problem: helping a small business put its existing support knowledge to work.

## Results

**Deployed apparel-store run · October 30, 2026**

- **60/60 source rows covered; 65 customer intents assigned**, each to one primary destination.
- **6 top-level choices and 55 answer destinations.** Related requests and supporting policies share destinations where appropriate.
- **10 initial audit findings → 2 → 0** after two targeted repair rounds. The saved draft had no remaining review flags.
- **301 required-fact checks recorded as present** in the final Muse audit, including facts reused across answers. All recorded source quotes and final audit excerpts matched the saved text.
- **18 minutes 18 seconds; 98 Muse calls**, including generation, audits and repairs.
- **65/65 local backend regression tests passed**, covering source coverage, scoped repair, verification failures and publication gates.

This is one deployed run on a [synthetic 60-row apparel dataset](samples/online_apparel_store_cs_en.csv). The audit is model-based; these counts are not an independently measured accuracy rate or evidence of performance across industries.\
The local regression tests use mocked model responses. End-to-end published audio remains to be validated.

## Key Implementation Files

- [Muse integration](cloud%20functions/utils/arsMuseLlm.js) — calls Meta’s model and validates its responses.
- [Menu generation](cloud%20functions/utils/arsMuseGenerator.js) — organizes questions, connects source passages and writes answers.
- [Quality checks and repairs](cloud%20functions/utils/arsMuseQuality.js) — audit routes and source requirements, validate quoted evidence and constrain menu patches.
- [Draft review](cloud%20functions/endpoints/ai/updateArsLeafReview.js) and [publication](cloud%20functions/endpoints/ai/publishArsMenu.js) — let staff edit answers, resolve review flags and publish.
- [Generation jobs](cloud%20functions/utils/arsMuseJobs.js) — manage background work and keep each draft tied to its source.

## What Comes Next

Next we’re validating the complete published voice flow, shortening longer spoken answers and reducing generation time without removing the quality checks.\
Evaluation on other business datasets is also still needed.\
The longer-term goal is straightforward: when a business updates its policies, updating customer support should be just as manageable.
