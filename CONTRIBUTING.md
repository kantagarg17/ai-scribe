# Contributing to AI-Scribe

Thanks for your interest in improving AI-Scribe. This is an open-source (Apache-2.0) research prototype and contributions are welcome.

## Ground rules

- **It's a prototype, not a medical device.** Keep language and behavior honest about that. Never present model output as medical advice.
- **Privacy first.** Don't add features that send a patient's record to a third party without an explicit, opt-in setting.
- **Stay vendor-neutral.** AI capabilities go behind the provider interfaces in `backend/app/providers`. Don't hard-code a single vendor into services or routers.

## Development setup

See the [README](README.md) quick start for backend and frontend setup.

## Workflow

1. Create a branch off `main`.
2. Make your change with clear, focused commits.
3. Run the backend tests and make sure the frontend builds:
   ```bash
   cd backend && pytest
   cd frontend && npm run build
   ```
4. Open a pull request describing what changed, why, and how you tested it.

## Code style

- **Python**: type hints, `ruff` for lint/format.
- **TypeScript/React**: functional components and hooks; `eslint` clean.

## Reporting issues

Open a GitHub issue with steps to reproduce, what you expected, and what happened. For anything security- or privacy-sensitive, note that in the issue title.
