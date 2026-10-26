# Citizen

**Citizen** is a real-world-triggered civic and startup simulation game.

Players manage both city-level civic systems (budgets, policies, social incidents, political events) and personal startups (Hipster CEO-style: idea, staff, product development, funding, exit), all modulated by live scraped data and the interconnected simulation effects.

Forked conceptually from civic-brief ideas and expanded into a full game backend + frontend.

## Tech Stack (planned)
- Frontend: React + React Flow (workflows), three.js (3D city), Highcharts, fabric.js, etc.
- Backend: PostgreSQL (simulation objects, effects, companies, real-world triggers) + pgvector for AI
- Data: Firecrawl for real-world ingestion

## Getting Started (Cursor)
1. Clone this repo: `git clone https://github.com/TayDa64/citizen.git`
2. Open the folder in Cursor.
3. `npm install`
4. `npm run dev`
5. Extend the WorkflowDiagram.jsx and add backend schema from previous design.

See the React Flow component in `src/WorkflowDiagram.jsx` for the core gameplay loop visualization.
