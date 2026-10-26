# Frontierbase — Meta AI Hackathon

Public development repository for the Frontierbase ARS project at the Meta Global AI Developer Hackathon 2026.

## Existing implementation and hackathon scope

The initial commit is a snapshot of **pre-existing Frontierbase code**, including the unpublished ARS prototype. It is not claimed as work created during the hackathon. Original Git history is not included in this public snapshot.

The existing backend includes hybrid RAG chat, dataset ingestion, ARS menu generation, review/publishing, and ElevenLabs speech synthesis. The ARS grouping and mapping need improvement.

Planned hackathon work: investigate and implement Meta Muse-based menu planning and source-to-menu assignment, with validation and before/after examples. **Meta integration is not implemented in this baseline.** Subsequent commits and the demo will identify the work actually completed during the event.

## Layout

- `cloud functions/`: Firebase Functions backend; ARS endpoints and mapping utilities.
- `cloud run/`: ingestion worker.
- `developer/`: existing developer documentation frontend.
- `docs/`: existing backend design notes.

## Local setup

Requires Node.js 22 and your own Firebase/GCP resources and provider credentials.

1. Copy `cloud functions/.env.example` to `cloud functions/.env` and configure the variables needed by the features you use. The example lists configuration names, not working credentials.
2. Provide your own Firebase service-account file at `cloud functions/store.json` (ignored by Git). Never commit it.
3. Install dependencies with `npm install` in the root and the relevant component directories.
4. Configure Firebase CLI for your own project. In `cloud functions/`, `npm run serve` starts the configured local Functions server. Existing source may require additional deployment configuration; this snapshot has not been verified as a turnkey installation.

Do not point a development deployment at production resources. Existing endpoint names and defaults originate from the baseline and must be reviewed for your own environment.

## Public snapshot exclusions

Local environment files, service-account keys, dependency directories, original Git history, internal root-level analyses, and local evaluation scripts/results are excluded. Files deleted from the source working tree were not restored from the Git index.

## Verification

The public baseline is checked for JavaScript syntax and common credential patterns before publication. No live API tests or production deployment are performed as part of repository creation.
