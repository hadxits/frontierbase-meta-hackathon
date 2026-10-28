# Frontierbase ARS

Work for the Meta Global AI Developer Hackathon 2026.

Frontierbase is a chatbot platform. Its ARS feature builds menus from uploaded documents and reads out answers using ElevenLabs.

The first version had trouble grouping related content and putting answers under the right menus. The Muse endpoints now plan a shared menu structure before assigning source material, then generate spoken answers from the assigned evidence.

The backend and ARS prototype were built before the event. Menu generation, review, publishing, and speech playback were already in place. The new Muse generation path is separate from the original APIs and uses the same draft storage and review flow.

Setup and API details are in [cloud functions/ARS_MUSE.md](cloud%20functions/ARS_MUSE.md). A small live Meta generation test passed. The deployed end-to-end flow still needs verification; no quality gains are claimed yet.
