# Agency OS — Product Requirements Document

**Version:** 2.1 (supersedes the March 2026 draft PDF; amends v2.0 stack choices — see §0.1)
**Owner:** Levi Eweka — Milktree Agency (`info@milktreeagency.com`)
**Lead Developer:** Sandesh Shrestha
**Date:** June 2026
**Build approach:** Evolve the existing `riftly-dashboard` codebase with Claude-assisted development. *(The original v2.0 spec assumed a greenfield Next.js scaffold; we are **not** doing that — see §0.1.)*

---

## 0. How to read this document & what changed from v1

This PRD is written so a developer (working with Claude) can build the entire system from scratch. Every module has a purpose, user stories, functional requirements, data entities, and acceptance criteria. Section 6 (Integration Architecture) is the part the team was most unsure about and is spec'd in depth.

**Deliberate changes from the March 2026 draft (the PDF):**

| Area | v1 (PDF) said | v2 (this doc) says | Why |
|---|---|---|---|
| Invoicing | "We are **not** building invoicing" | **Full invoicing + online payments** (Stripe; GoCardless later) | Owner decision — retainers + one-off billing is core to the retainer business model. |
| Client task board | Clients can **only view** tasks | Clients can **create and comment** on tasks (shared Asana/Trello model) | Owner decision — two-way task collaboration. |
| Analytics scope | Client-portal only | **Owner/Team see every client's analytics** in one aggregator, plus per-client portal | Owner decision — founder visibility across all accounts. |
| Time tracking | Simple per-task timer | **Everhour-style** tracking with role-based visibility + **profitability** | Owner decision. |
| Data integration | "Connect to / pull data from" GA4, Ads, etc. (method unspecified) | **Direct APIs + nightly sync into our own DB**; MCP reserved for the AI layer only | Research finding — see §6. |
| Frontend / backend stack | Next.js 16 App Router (greenfield) | **React + Supabase** (evolve existing repo) | Team decision — reuse the live `riftly-dashboard` build; see §0.1 and §10. |

> **Naming note:** Product name is **Agency OS**. The repository/folder is currently `riftly_dashboard`; rename or alias as preferred.

### 0.1 Implementation stack (locked)

We are **sticking to React and Supabase** for Agency OS. This is an explicit implementation decision on top of the product spec above — it does **not** change what we are building, only **how**.

| Layer | Chosen implementation | Notes |
|---|---|---|
| **Frontend** | **React** (Vite) + TypeScript + `react-router-dom` | Single SPA hosts both the internal app and the client portal (role-based routing). Reuse existing UI (shadcn, layouts, task board, etc.). |
| **Backend / data** | **Supabase** — Postgres, Auth, RLS, Storage, Vault | Tenant isolation stays DB-enforced via RLS. SQL migrations in `supabase/migrations/` remain the schema source of truth. |
| **Client SDK** | `@supabase/supabase-js` | Direct from the React app for user-scoped reads/writes; `service_role` only in Edge Functions / background workers. |
| **Server-side work** | **Supabase Edge Functions** (+ Inngest where long-running jobs are needed) | Stripe webhooks, connector sync orchestration, AI report worker, email sends — not Next.js API routes. |
| **Hosting** | Static frontend (e.g. Vercel/Netlify) + Supabase project | No Next.js App Router requirement. |

The original §10 table still lists Next.js, Drizzle, and Vercel-centric choices from the research pass — those remain for context. **Where §10 and this section differ, this section wins.**

---

## 1. Overview & Vision

Agency OS is a centralised operating system for a digital marketing agency that is shifting from one-off website projects to **recurring retainers** (SEO, Google Ads, paid social, email, Google Maps/Local). It replaces the sprawl of Asana + spreadsheets + separate CRM + manual reporting + Slack/Notion with a single source of truth.

It has **two sides sharing one codebase and one database**:

1. **Internal app** — for the agency (Founder + Team). Run the business: tasks, sales pipeline, client health, finances, invoicing, time, analytics across all clients, and an AI tooling knowledge base.
2. **Client portal** — for each client. A professional, white-labeled window into *their* project: task board, performance analytics, invoices & payments, and a monthly AI-generated report.

The strategic point: a polished portal + professional monthly reporting is what turns a one-off client into a long-term retainer. Operationally, one tight tool means the team actually uses it.

---

## 2. Goals & Success Metrics

**Product goals**
- G1 — One screen gives the Founder full visibility: revenue vs target, pipeline, leads, client health, overdue invoices, and at-risk accounts.
- G2 — The team manages 100% of client work (tasks, time, deliverables) inside Agency OS; no Asana.
- G3 — Every retainer client logs in and sees live performance + invoices + a monthly report without the agency assembling anything by hand.
- G4 — Invoices (retainer + one-off) are generated, sent, and paid online with status auto-reconciled.
- G5 — All per-client external data (GA4, Search Console, Google Ads, Meta Ads, GBP, leads) is fetched **reliably and reproducibly**.

**Success metrics (review 90 days post-launch)**
- ≥ 90% of active client work items live in Agency OS (vs external tools).
- ≥ 80% of retainer clients log in to the portal at least monthly.
- Monthly reports generated and emailed automatically for 100% of retainer clients.
- < 1% of dashboard metric values disputed by clients as "wrong vs the platform UI" (data-trust target).
- Invoice "paid" status auto-reconciled within 5 minutes of payment, ≥ 99% of the time.
- Zero cross-tenant data exposure incidents (hard requirement).

---

## 3. Personas & Roles

### 3.1 Personas
- **Founder (Levi)** — owner. Wants the whole business on one screen; cares about revenue, pipeline, client retention, and team output.
- **Team Member (employee)** — account manager / specialist. Works across **all** clients; needs tasks, time tracking, client analytics, and leads. *(Per owner: an employee logs in and sees all clients.)*
- **Client** — sees **only their own** organisation: their tasks, analytics, invoices, report, files, approvals, and a message thread with the agency.

### 3.2 Role model
Three roles, enforced at the database layer (see §9). A future **Client-Admin vs Client-Viewer** sub-distinction is noted but not in v1 scope.

### 3.3 Permission matrix

| Capability | Founder | Team | Client |
|---|:--:|:--:|:--:|
| View all clients' tasks / boards | ✅ | ✅ | — |
| View/create/comment **own** tasks | ✅ | ✅ | ✅ (own org only, create + comment; cannot reassign/delete agency tasks) |
| CRM / deals pipeline | ✅ | ✅ | — |
| Client accounts (health, renewals, MRR) | ✅ | ✅ (view; edit configurable) | — |
| Analytics — **all** clients | ✅ | ✅ | — |
| Analytics — **own** | ✅ | ✅ | ✅ |
| Unified Leads inbox — all | ✅ | ✅ | own only |
| Finance dashboard (MRR vs target) | ✅ | ✅ (view progress) | — |
| Create/send/void invoices | ✅ | configurable | — |
| View/pay **own** invoices | ✅ | — | ✅ |
| Time tracking (log own time) | ✅ | ✅ | — |
| Time & profitability reports (all) | ✅ | configurable | — |
| Contracts / proposals / e-sign | ✅ | ✅ | sign own |
| Approvals & files | ✅ | ✅ | own (approve/upload/download) |
| Messaging (DMs + channels) | ✅ | ✅ | client↔agency channel only |
| Claude Skills library | ✅ | ✅ | — |
| Connections / integrations setup | ✅ | configurable | grant access during onboarding |
| Settings, user management, billing config | ✅ | — | — |
| Audit log | ✅ | — | — |

"Configurable" = governed by a granular permission flag the Founder can toggle per team member; default conservative.

---

## 4. Information Architecture & Navigation

### 4.1 Internal app (left nav)
1. **Cockpit** (Founder home / exec overview)
2. **Tasks** (Kanban + list + my tasks + timers)
3. **Pipeline** (CRM deals)
4. **Clients** (accounts list → client detail)
5. **Analytics** (cross-client aggregator → per-client drilldown)
6. **Leads** (unified inbox)
7. **Finance** (revenue, invoices, payments)
8. **Time** (timesheets, reports, profitability)
9. **Contracts** (proposals, contracts, e-sign)
10. **Messages** (DMs + channels)
11. **Skills** (Claude tooling knowledge base)
12. **Settings** (team, roles, connections, billing config, audit log)

### 4.2 Client portal (simplified nav)
1. **Overview** (their KPI snapshot + latest report)
2. **Tasks** (their board)
3. **Performance** (their analytics)
4. **Reports** (monthly AI reports archive)
5. **Invoices** (owed / paid / history + pay button)
6. **Files & Approvals**
7. **Messages** (thread with the agency)

The client portal is branded as Agency OS / Milktree (white-labeled — no third-party logos in the primary view).

---

## 5. Functional Modules

> Each module: **Purpose · Users · User stories · Functional requirements · Data entities · Acceptance criteria.** Data entities here are summaries; the consolidated schema is in §8.

### 5.1 Founder Cockpit
**Purpose:** the single screen of business health.
**Users:** Founder (Team gets a reduced version).
**User stories:**
- As the Founder, I see this month's MRR vs target, pipeline value, total leads across all clients, overdue invoices, and accounts flagged at-risk, the moment I log in.
**Functional requirements:**
- Configurable monthly revenue target with a visual progress gauge (MRR + one-off income vs target).
- Cards: Active clients, MRR, New deals value, Leads (MTD, all clients), Outstanding invoices (£ + count), Renewals due (next 30/60 days), At-risk accounts.
- "At-risk" = rule-based flag (e.g., no activity N days, falling key metric, overdue invoice, renewal < 30 days, broken data connection).
- Time range selector; all figures read from the metrics store / app DB (never live external APIs).
**Data entities:** reads from `client`, `invoice`, `lead`, `deal`, `metric_daily`, `revenue_target`.
**Acceptance criteria:**
- [ ] Cockpit loads in < 1.5s (cached reads).
- [ ] Revenue gauge reflects MRR from active retainers + recognised one-off income for the period.
- [ ] At-risk list is explainable (hover shows which rule fired).

### 5.2 Task Management (Kanban + Time + Two-way Client)
**Purpose:** replace Asana; shared task board between agency and client.
**Users:** Founder, Team, Client (scoped to own org).
**User stories:**
- As a Team member I drag a task across columns and log time on it.
- As a Client I create a task ("please update the homepage hero") and watch it move through the agency's workflow; I can comment but not reassign internal tasks.
**Functional requirements:**
- Kanban board with **configurable columns** (default: To Do, In Progress, In Review, Done) and drag-and-drop (dnd-kit), with persisted order/position.
- Task card fields: title, description, **client/project**, assignee(s), due date, status/column, priority, labels, attachments, comments, time logged.
- List view + "My Tasks" view + filters (client, assignee, status, due).
- **Client-created tasks:** a client can create tasks in their own board and comment; these enter a defined intake column; agency controls assignment/columns. Clearly visually distinguish client-created vs agency-created.
- **Time tracking on tasks:** start/stop timer + manual entry; multiple entries per task per user; billable flag. (Shared engine with §5.9.)
- Activity feed per task; @mentions trigger notifications.
- Boards are scoped per client/project; an internal "agency ops" board exists for non-client work.
**Data entities:** `board`, `column`, `task`, `task_comment`, `task_attachment`, `time_entry`.
**Acceptance criteria:**
- [ ] Drag-drop reorder persists and is correct after refresh and across users (optimistic UI + server reconciliation).
- [ ] A client only ever sees their own org's board; verified by RLS test.
- [ ] Timer survives navigation/refresh; manual edits audited.
- [ ] Client-created task generates a notification to the assigned account manager.

### 5.3 CRM — Deals Pipeline (New Clients)
**Purpose:** track prospects from lead to closed.
**Users:** Founder, Team.
**User stories:** As the Founder this is my primary view of where each new opportunity stands.
**Functional requirements:**
- Kanban of deals, configurable stages (default: Lead, Proposal Sent, Negotiation, Closed Won, Closed Lost).
- Deal card: prospect/company name, contact, services of interest, deal value, expected close date, next action + owner, source.
- Drag between stages; stage-change timestamps for velocity reporting.
- **Closed Won → conversion:** one click creates a Client Account (§5.4) and optionally kicks off Onboarding (§5.5) and a Contract/Proposal (§5.10). A deal value can seed a retainer (MRR) or one-off.
- Pipeline summary: total weighted value, value by stage, win rate.
**Data entities:** `deal`, `deal_stage`, `deal_activity`, `contact`.
**Acceptance criteria:**
- [ ] Converting a won deal creates a linked `client` with no double entry.
- [ ] Pipeline value totals match the sum of deal values per stage.

### 5.4 Client Accounts (Existing Clients)
**Purpose:** at-a-glance health of every active relationship.
**Users:** Founder, Team.
**Functional requirements:**
- Clients list: name, logo, services/retainer type, **MRR**, renewal date, account manager, health flag, open tasks count, connection-health badge, outstanding balance.
- Client detail page = the hub: overview, contacts, services, tasks, analytics, leads, invoices, files, contracts, connections, message thread, report history.
- Service/retainer config drives MRR and the finance rollups.
- Renewal tracking with alerts (30/60-day).
**Data entities:** `client` (org/tenant), `client_contact`, `service`/`retainer`, `client_health`.
**Acceptance criteria:**
- [ ] MRR shown per client equals the sum of active retainer line items.
- [ ] Connection-health badge reflects real connector status (§5.5/§6).

### 5.5 Client Onboarding & Connections (Integrations Hub)
**Purpose:** the guided, reliable way to connect each client's data sources; ongoing connection health. *(This module is what makes the analytics "work particularly well.")*
**Users:** Founder, Team (drive it); Client (grants access).
**User stories:**
- As a Team member onboarding a client, I follow a checklist that walks the client through granting GA4/Ads/Meta/GBP access, and I can see exactly which connections are live, pending, or broken.
**Functional requirements:**
- **Onboarding wizard** per client: company details, services, contacts → then a per-provider "Connect" step (see §6 for each provider's exact grant mechanism).
- A **`connection`** record per (client, provider): status (`not_connected | pending | connected | error | expired`), the external account/property/page IDs mapped to this client, last sync time, last error.
- **Connection health dashboard** (internal): every client × provider, with a "Reconnect" action and alerting when a token expires or a grant is revoked (tokens silently die — see §6 gotchas).
- Per-provider connect flows: service-account-grant instructions (GA4, GSC), OAuth consent (GBP), MCC link-invite (Google Ads), Partner-access grant (Meta), webhook/API-key (CallRail/WhatConverts), self-serve form embed (own lead form).
- Client-side: a lightweight "Connect your accounts" view in the portal for self-serve grants where applicable.
**Data entities:** `connection`, `connection_account_map`, `oauth_token` (in vault, §9), `webhook_endpoint`.
**Acceptance criteria:**
- [ ] Each provider has a documented, testable connect flow with a "verify connection" call that confirms data is retrievable.
- [ ] Expired/revoked tokens surface as `error/expired` with an alert and a reconnect path within one sync cycle.
- [ ] No connection can be mapped to the wrong tenant (mapping is validated and audited).

### 5.6 Client Analytics Aggregator
**Purpose:** all the numbers — GA4, Search Console, leads, ad spend, ads performance, GBP — for every client (owner view) and per client (portal view).
**Users:** Founder, Team (all clients); Client (own).
**User stories:**
- As the Founder I open Analytics and see a cross-client table (traffic, leads, spend, ROAS, local visibility) and can drill into any client.
- As a Client I see my channels in a clean overview — traffic, ad performance, local search, leads.
**Functional requirements:**
- **Cross-client overview** (internal): sortable table of headline KPIs per client for a selected period, with MoM deltas and sparklines.
- **Per-client dashboard** (internal drilldown + portal): grouped by channel:
  - *Website (GA4):* sessions, users, new users, engagement rate, key events/conversions, channel mix, top sources.
  - *Search (GSC):* clicks, impressions, CTR, avg position, top queries/pages.
  - *Google Ads:* spend, impressions, clicks, conversions, CPA, ROAS, top campaigns.
  - *Meta Ads:* spend, reach, results/leads, CPL, ROAS, top campaigns.
  - *Local (GBP):* map/search impressions, calls, direction requests, website clicks, reviews + rating.
  - *Leads:* unified count + trend + by-source (links to §5.7).
- All values come from the **metrics store** (synced nightly); each view shows an **"as of" timestamp**, flags the **last ~3 days as provisional**, and footnotes data-quality caveats (sampling, consent-mode, attribution) where relevant.
- Optional **embedded Looker Studio deep-dive** per channel for power users (row-level-security connector so the client sees only their data without a Google login) — Phase 3 / optional.
- Date-range selector; export to PDF/CSV; "verify in platform" deep links.
**Data entities:** `metric_daily`, `metric_monthly_rollup`, `channel`, `connection`.
**Acceptance criteria:**
- [ ] Every KPI traces to a stored, dated row (reproducible; no live API call on page load).
- [ ] Numbers reconcile to within documented tolerances of the source UIs; discrepancies are footnoted, not hidden.
- [ ] Client view is strictly scoped to own org (RLS test).

### 5.7 Unified Leads Inbox
**Purpose:** one de-duplicated "number of leads" + lead list across all sources.
**Users:** Founder, Team (all); Client (own count/list).
**User stories:** As the Founder I see total leads this month per client and can open any lead to see source, contact, and value.
**Functional requirements:**
- Ingest leads from: **own embeddable web form**, **Meta Lead Ads** (real-time leadgen webhook + Graph backfill), **Google Ads lead forms** (API pull, 60-day window), **CallRail/WhatConverts** (call/form webhooks), and **CRM/manual**. GA4 `generate_lead` and GBP calls/messages are shown as **count-only cross-check signals** (no contact PII).
- **One canonical `lead` model** (see §8) + a `raw_event` audit table storing every inbound payload verbatim.
- **Deterministic de-duplication:** normalise phone to E.164 (primary key) then email; merge within a configurable 30–90 day window; keep cross-source identity links so the count is de-duplicated while each touch is retained for attribution.
- Idempotent ingestion (upsert on provider event id) to tolerate at-least-once webhooks.
- Per-client **lead definition config**: which sources count, include/exclude spam, dedupe window.
- Lead detail: source, channel/campaign attribution, contact, value, status/stage, spam/qualified flag.
**Data entities:** `lead`, `lead_identity`, `raw_event`, `connection`.
**Acceptance criteria:**
- [ ] Same human arriving via form + tracked call + Meta lead counts as **one** lead.
- [ ] Webhook redelivery does not create duplicates.
- [ ] GBP/GA4 signals are visibly labelled "aggregate/modeled" and excluded from the contact-bearing list.

### 5.8 Finance, Invoicing & Payments
**Purpose:** generate/send invoices (retainer + one-off), collect online, auto-reconcile; clients see what they owe/paid.
**Users:** Founder (+ configurable Team); Client (own invoices + pay).
**User stories:**
- As the Founder I create a monthly retainer invoice or a one-off project invoice, send it, and watch it auto-mark paid when the client pays online.
- As a Client I see my outstanding balance, invoice history, amounts, and a Pay button.
**Functional requirements:**
- **Our DB is the system of record**; Stripe is the collection engine; **webhooks reconcile status** (never trust the redirect/return URL).
- **Retainers** = Stripe Billing Subscriptions (recurring monthly Price); **one-off jobs** = Stripe Invoicing (InvoiceItems → finalize → send).
- Invoice lifecycle: draft → open/sent → paid / past_due / void / uncollectible. Store `hosted_invoice_url` + `invoice_pdf`.
- Client portal billing view reads from our mirrored tables; "Pay" links to the Stripe-hosted invoice page; optional Stripe Customer Portal for self-serve history/cards.
- **Stripe Tax** enabled for UK VAT + B2B reverse-charge; capture/store client VAT numbers; per-line tax breakdown stored.
- **£ (British Pounds)** primary, with USD/EUR presentment; currency fixed per invoice.
- **Dunning:** act on `invoice.payment_failed`; surface `past_due` in portal; reminder emails.
- Finance dashboard: MRR, one-off income, outstanding, paid vs overdue, revenue vs target (feeds Cockpit).
- **GoCardless (Phase 3):** behind a provider abstraction for UK Direct Debit on retainers (lower fees, no chargebacks); generate our own PDF since GoCardless does not.
**Data entities:** `customer`(→client), `invoice`, `line_item`, `payment`, `subscription`/`retainer`. Single idempotent, signature-verified Stripe webhook endpoint; map provider object id → client_id.
**Acceptance criteria:**
- [ ] `invoice.paid` flips status within minutes; webhook is idempotent (dedupe on `event.id`).
- [ ] Retainer renewals auto-create and email the monthly invoice.
- [ ] A client can only ever see/pay their own invoices.
- [ ] VAT is correctly applied/recorded for UK + reverse-charge cases.

### 5.9 Time Tracking & Profitability
**Purpose:** Everhour-style time tracking with role-based visibility; feed per-client profitability.
**Users:** Founder, Team (log own time); Founder + (configurable) Team (reports).
**User stories:**
- As an employee I start a timer on a task or log time manually; I see my own timesheet.
- As the Founder I see hours per client and the **margin** (retainer revenue − labour cost) per client.
**Functional requirements:**
- Timers (start/stop) + manual entries; entries attach to task + client + user; billable flag; description.
- **Cost model:** each team member has an internal cost rate (£/hr); profitability = client revenue (retainer MRR + one-off) − (Σ hours × cost rate) for the period.
- Timesheet views (my week), team reports (by user/client/period), utilisation.
- **Per owner decision:** hours **feed profitability + reports**; invoices remain **manually created** (no auto hours→invoice in v1; provider abstraction leaves room for it later).
- **Visibility:** employees see all clients; a Client never sees agency time data.
**Data entities:** `time_entry`, `cost_rate`, `profitability_rollup` (derived).
**Acceptance criteria:**
- [ ] Profitability per client = revenue − labour cost over the chosen period, with drill-down to entries.
- [ ] Clients have zero access to any time/cost data (RLS test).
- [ ] Cost rates are visible only to the Founder.

### 5.10 Contracts, Proposals & E-sign
**Purpose:** turn a won deal into a signed agreement and an active client.
**Users:** Founder, Team; Client (signs).
**Functional requirements:**
- Proposal/contract templates with merge fields (client, services, retainer £, term, scope).
- Generate from a deal; send for **e-signature**; on signature, auto-create/activate the client + retainer and (optionally) the first invoice.
- Store signed PDF + audit trail (who/when/IP).
- v1 e-sign: integrate a provider (e.g., a signature API) or a built-in click-to-sign with audit metadata; pick during design of this module.
**Data entities:** `contract`, `contract_template`, `signature_event`.
**Acceptance criteria:**
- [ ] A signed contract produces an immutable PDF + audit record.
- [ ] Signature transitions the deal/client to active and seeds the retainer.

### 5.11 Approvals & File Sharing
**Purpose:** professional deliverable hand-off and sign-off in the portal.
**Users:** Founder, Team (upload/request); Client (review/approve/download).
**Functional requirements:**
- Upload deliverables (creative, docs, drafts) to a client; request approval; client approves/requests changes with comments.
- Versioning; status (pending / approved / changes-requested); notifications on each transition.
- File library per client with signed-URL downloads.
**Data entities:** `file_asset`, `approval`, `approval_comment`.
**Acceptance criteria:**
- [ ] Approval state changes notify the right people and are audited.
- [ ] Files are tenant-isolated; downloads use expiring signed URLs.

### 5.12 Messaging (DMs + Channels)
**Purpose:** internal + client communication inside the platform (reduce Slack reliance).
**Users:** Founder, Team (DMs + channels); Client (their channel only).
**User stories:**
- As a Team member I DM a colleague and post in a per-client channel.
- As a Client I message the agency in my dedicated channel and get replies.
**Functional requirements:**
- **Direct messages** between team members.
- **Channels:** per-client/project channels (internal) + one **client↔agency channel** exposed in the portal.
- Real-time delivery (websockets/Supabase Realtime), unread counts, @mentions → notifications, attachments, message history/search.
- Client visibility strictly limited to their own client↔agency channel.
**Data entities:** `conversation` (dm|channel), `conversation_member`, `message`, `message_attachment`, `read_receipt`.
**Acceptance criteria:**
- [ ] Messages deliver in real time; unread badges accurate across devices.
- [ ] A client cannot see internal channels/DMs (RLS + membership test).
> *Scope guard:* this is "enough messaging," not a Slack rebuild — no huddles/threads-of-threads/integrations in v1.

### 5.13 Claude Skills Library
**Purpose:** internal knowledge base for the agency's Claude automations/skills.
**Users:** Founder, Team.
**Functional requirements:**
- CRUD entries: title, description, category/tags, **how-to-use notes**, example prompts/inputs, links, owner, last-updated.
- Search/filter; markdown body; optional version notes.
**Data entities:** `skill_doc`.
**Acceptance criteria:**
- [ ] Team can find a skill by name/tag and read usage notes in < 10s.

### 5.14 Notifications & Audit Log
**Purpose:** keep people informed; keep the system accountable.
**Functional requirements:**
- **Notifications:** in-app + email (Resend) for: task assignment/mention, client-created task, approval requests/decisions, invoice paid/overdue, connection broken, renewal due, report ready, new message/mention. Per-user preferences.
- **Audit log (Founder-only):** record security- and money-relevant events (logins, role changes, connection grants/revokes, invoice create/void, contract signature, data exports, tenant-mapping changes) with actor, timestamp, before/after.
**Data entities:** `notification`, `notification_pref`, `audit_event`.
**Acceptance criteria:**
- [ ] Every money/security action writes an immutable audit row.
- [ ] Users can mute categories without losing critical (billing/security) alerts.

### 5.15 Client Portal (composition)
**Purpose:** the client's white-labeled home; composes the client-scoped views of the modules above.
**Functional requirements:** Overview (KPI snapshot + latest report), Tasks (their board, two-way), Performance (their analytics), Reports (archive + view), Invoices (owed/paid/history + pay), Files & Approvals, Messages.
**Acceptance criteria:**
- [ ] A logged-in client can reach **nothing** belonging to another client or to internal ops — verified by an automated cross-tenant test suite.
- [ ] Portal is visually branded (no stray third-party logos in the primary experience).

---

## 6. Integration Architecture (the core of "make the data work well")

### 6.1 Principles — APIs vs MCP
**Decision:** a **two-plane architecture**.

- **Plane A — Deterministic data backbone (owns every number):** direct official **REST/GraphQL APIs** → **scheduled sync (ETL)** → our own **normalized metrics store** in Postgres → our own charts. The dashboard reads **only** from our store, never live external APIs on page load.
- **Plane B — AI layer (MCP / Claude tool-use):** the **monthly AI report** and an optional **"ask your data"** chat. Claude reads **our already-synced, tenant-scoped database** (via internal tools/an internal MCP), **not** the live ad APIs.

**Why not drive the dashboard via MCP** (even though Meta/Google/TikTok now ship official Ads MCP servers):
- MCP calls route through an LLM → **non-deterministic**; client-facing numbers must be exactly reproducible.
- MCP has **no built-in tenant isolation** (documented 2026 cross-tenant incidents).
- Official Meta/Google Ads MCPs use **interactive browser OAuth** → can't run unattended on a schedule, and recommend one-connector-per-client.
- MCP on the hot path = **unbounded LLM cost** per page view.

**Vendor MCP servers are still useful** — for the agency team's **ad-hoc human exploration** in Claude/ChatGPT (outside the dashboard), and as a model for the **internal** report tooling. They are not the production data path.

**Looker Studio / "Data Studio":** it has **no API that returns report numbers**, so it can't be a data source for the dashboard or the AI report. There is **no Data Studio MCP** (the MCP belongs to *enterprise Looker*, a separate paid product). We build native charts; we may *optionally* embed a Looker Studio report for deep-dives using a **row-level-security community connector** so clients see only their own data without a Google login.

### 6.2 Reference architecture (components to build)
1. **Integration Service** — orchestration + internal API the app calls for synced data.
2. **Per-provider Connectors** — `GA4Connector`, `GSCConnector`, `GoogleAdsConnector`, `MetaConnector`, `GBPConnector`, plus lead adapters and `StripeConnector`. Each implements `fetch()` + `normalize()` behind a common interface so provider/version specifics don't leak into the UI or schema.
3. **Token Vault** — per-client encrypted credentials (Supabase Vault / KMS), tenant-scoped, accessed only by server-side service-role functions; with refresh + revocation handling and health checks.
4. **Sync Scheduler** — Inngest jobs: nightly (and intraday for spend-sensitive metrics) per-client fan-out with bounded concurrency, backoff+jitter, per-account rate-limit budgets, **idempotent upserts**, and **rolling re-sync windows** to absorb late/adjusted data.
5. **Normalized Metrics Store** — Postgres tables keyed by `(tenant_id, provider, account_id, entity, date, metric, value)` + pre-computed derived/blended metrics (CPL, ROAS, MoM/YoY, pacing).
6. **Webhook Intake** — signature-verified endpoints for leads (Meta leadgen, CallRail, WhatConverts, own form) and payments (Stripe); fast 200 + enqueue to worker; idempotent.
7. **AI Report Worker** — Anthropic tool-use over the internal store, **tenant_id enforced**, generating the monthly report + PDF.

### 6.3 Per-connector specifications

#### GA4 (Google Analytics 4) — Data API + Admin API
- **Auth:** prefer a **service account added as Viewer/Analyst** to each client GA4 **account** (auto-covers future properties); fall back to OAuth offline (refresh token, scope `analytics.readonly`). Discover properties via Admin API `accountSummaries.list`.
- **Data:** sessions, users, new users, engagement rate, **keyEvents** (= conversions/leads; isolate lead events via `eventName` + `isKeyEvent`), channel mix (`sessionDefaultChannelGroup`/`sessionSourceMedium`), first-touch via `firstUser*`.
- **Sync:** nightly per-property; **re-pull trailing 3 days** (24–48h processing lag; last days provisional). `returnPropertyQuota=true`, concurrency ≤ 10/property, stagger to respect the per-project-per-property hourly token cap.
- **Gotchas:** sampling on big queries (check `samplingMetadatas`), `(other)` high-cardinality bucket, data thresholding with Google Signals, consent-mode modeling. Cache in our DB — never query GA4 on page load.
- **Approval:** service-account route avoids OAuth verification (days). Public multi-account OAuth = sensitive-scope verification (~weeks).

#### Google Search Console — Search Analytics API
- **Auth:** OAuth `webmasters.readonly` (or service account added as Full user/owner — add as *user before* owner to avoid the known access bug). **No API to self-add** — onboarding always includes a manual per-property grant.
- **Data:** clicks, impressions, CTR, average position by query/page/country/device/date; sitemaps; URL inspection (budget against 2,000/day/property).
- **Sync:** nightly; paginate `rowLimit=25000`; query day-by-day to beat ~50k-rows/type/day sampling; **store a 16-month rolling window** (data older than 16 months is deleted by Google — we must own history); use `dataState=final` for reporting.
- **Gotchas:** ~2–3 day lag; **query anonymization (~47% of clicks have no query)** so query rows never sum to totals — always store property-level totals separately; any filter drops anonymized clicks.

#### Google Ads — Google Ads API
- **Auth:** one agency **Manager (MCC)** account; **one** OAuth refresh token + a **developer token**; per request set `login-customer-id = MCC` and `customer_id = client`. Onboard clients via **MCC link-invite** (no per-client OAuth). Client library: official (Python/Java/.NET/Ruby/PHP) or the community Node `google-ads-api` (Opteo).
- **Data (GAQL):** `cost_micros` (÷1,000,000), impressions, clicks, CTR, conversions, `conversions_value` (**not** micros), `cost_per_conversion` (micros), ROAS = value/cost (compute yourself), by campaign/ad group/keyword/date.
- **Sync:** nightly batched `SearchStream`; **re-sync trailing ~14 days** (conversion lag + retroactive attribution); use `*_by_conversion_date` or settled windows for monthly reports.
- **Access tiers (critical path):** **Test** (instant, test accounts only) → **Explorer** (often auto-granted, **production** data at **2,880 ops/day**, blocks account-creation/user-mgmt/planning/billing) → **Basic** (15,000 ops/day; official target **5 business days**, realistically 1–3 weeks due to a Feb-2026 backlog) → **Standard** (unlimited; ~10 business days; RMF audit). **Strategy:** launch on **Explorer** for early real data, target **Basic** for production; apply Day 1. Ensure `milktreeagency.com` is live and the API contact email is monitored (common rejection reasons).
- **MCP:** official read-only MCP exists (3 tools) — dev/exploration only, not production runtime.

#### Meta Ads (Facebook/Instagram) — Marketing API + Lead Ads
- **Auth:** one agency **Business-type App** + **one non-expiring System User token** from the agency Business Portfolio. Clients grant **Partner access** to ad account + Page; assign assets to the System User. Scopes: `ads_read`, `leads_retrieval`, `business_management`, `pages_*` (for leadgen). Iterate `act_{ad_account_id}` per client.
- **Data:** spend, impressions, reach, frequency, clicks, CPC/CPM, results, ROAS via `/insights`; **lead count** from `actions` where `action_type='lead'/'leadgen'`, CPL from `cost_per_action_type`. Use the **async insights** endpoint for monthly/large pulls (avoids timeouts; note: async still counts toward rate limits).
- **Leads:** subscribe a **webhook to the Page `leadgen` field**; on event, `GET /{leadgen_id}` for `field_data`.
- **Sync:** nightly; **always pass explicit `action_attribution_windows`** (e.g., `7d_click,1d_view`) — **`7d_view`/`28d_view` were removed Jan 12, 2026** and silently return blank; **`28d_click` remains**. **Re-sync 28-day rolling window**; store our own history (Meta retention: 37mo aggregate / 13mo unique/hourly / 6mo frequency). Read `X-Business-Use-Case-Usage` to throttle.
- **Approval:** Business Verification (1–2 wks) + App Review for Full Access (reach 500 Marketing-API calls/15 days, <15% error rate; no screen-recording as of May 2026). End-to-end ~3–6 weeks; start verification Day 1. Note: System-User count is tier-gated (1 on Limited, up to 10 on Full).
- **MCP:** official Meta Ads MCP exists (Apr 2026) — interactive-OAuth, no multi-tenant isolation, no leadgen — **not** the production runtime.

#### Google Business Profile — Performance API (+ v4 reviews)
- **Auth:** OAuth `business.manage`; the authed account must **manage each location** (prefer: clients add the agency account/group as manager so one consent covers all). Enumerate via Account Management + Business Information APIs.
- **Data:** `BUSINESS_IMPRESSIONS_{DESKTOP,MOBILE}_{MAPS,SEARCH}` (sum these for "total impressions"), `CALL_CLICKS`, `BUSINESS_DIRECTION_REQUESTS`, `WEBSITE_CLICKS`, `BUSINESS_CONVERSATIONS`, monthly search keywords; reviews + average rating via v4.
- **Sync:** nightly/monthly; aggregate to calendar months ourselves; run monthly reports **~5 days into the new month** (data lag); document the timezone-offset day boundary.
- **Approval (longest pole — TWO gates):** (1) **GBP API allow-listing** via the "Basic API Access" form (verified GBP 60+ days, live website, project number; **no SLA**, days–6 weeks; quota 0→300 QPM = approved; can be granted **unevenly per API** — verify all). (2) Because `business.manage` is a **sensitive scope**, a public per-client-consent app **also** needs **OAuth consent-screen verification** (sensitive-scope, not the heavier restricted/CASA). Plan both Day 1. **Q&A API is discontinued (Nov 2025)** — don't rely on it.
- **MCP:** community only — not the production path.

#### Leads ingestion (unified) — see §5.7
- **Webhooks-first** (own form, Meta leadgen, CallRail, WhatConverts) + **API backfill** (Google Ads lead forms ≤60-day window — sync more often than 60 days or lose data permanently; GA4 counts; GBP aggregates). Canonical `lead` + `raw_event`; deterministic dedupe; idempotent upserts; per-tenant account mapping (mis-mapping = cross-client leak → must be validated/audited). PII encrypted; GDPR deletion honoured.

#### Stripe (+ GoCardless later) — see §5.8
- **Single-merchant** model (agency = one Stripe account; each client = a Customer — **no Stripe Connect**). DB is system of record; **webhooks** (`invoice.paid`, `invoice.payment_failed`, `invoice.finalized`, `customer.subscription.*`) reconcile. Stripe Tax for UK VAT. One idempotent signed webhook endpoint; map provider id → client_id. **Self-serve, days to go live.**

### 6.4 Access-approval checklist (start ALL on Day 1 — this is the critical path)

| Provider | Action | Realistic lead time | Blocks Phase |
|---|---|---|---|
| Google Cloud project + OAuth consent screen | Create, configure, submit sensitive-scope verification | days–weeks | 2 |
| Google Ads | Create MCC, get developer token, **apply for Basic** (use Explorer meanwhile) | 1–3 weeks | 2 |
| Meta | Business-type app, **Business Verification**, App Review (Full Access) | 3–6 weeks | 2 |
| GBP | API allow-listing form **+** sensitive-scope OAuth verification | days–6 weeks | 2 |
| GA4 / GSC | Service-account or per-property grants (per client) | days (ongoing) | 2 |
| CallRail / WhatConverts | API key + webhooks (client-provided) | days | 2/3 |
| Stripe | Account activation + Stripe Tax/VAT config | days | 1 |
| Resend | Domain verification + warmup | days | 1 |

> **Implication for the plan:** Phase 1 (operations core + Stripe) ships **without** waiting on any ad/analytics approval. Connectors are stubbed behind the `connection` model and switch on per client as approvals land.

### 6.5 Data-trust rules (apply everywhere)
- Show an **"as of" timestamp** and a freshness badge on every external-data view.
- Flag the **most recent ~3 days as provisional**.
- **Footnote** sampling / consent-mode / attribution / anonymization caveats rather than hiding discrepancies.
- Keep a **raw-response audit log** per sync for reconciliation.
- Provide **"verify in platform"** deep links.

---

## 7. AI Monthly Report Generator
**Purpose:** auto-generate a professional monthly report per retainer client; viewable in the portal and emailed.
**Functional requirements:**
- At month-end (run a few days into the new month for data completeness), an Inngest job per client gathers **pre-aggregated rows from our store** (not live APIs): tasks completed, key metric movements (MoM/YoY), channel performance, leads, spend/ROAS, local visibility.
- Claude (**`claude-opus-4-8`** for final synthesis; **`claude-sonnet-4-6`** for drafting; **`claude-haiku-4-5`** for classification) writes: what was done, how metrics moved (with plain-English context + caveats), and the plan for next month.
- Render to **PDF** (@react-pdf/renderer) + store (Supabase Storage, signed URL); email via **Resend**; archive in the portal.
- **Tenant isolation enforced** in the worker — the agent only ever sees one client's data per run.
- Cost control: prompt caching (shared template/system prompt) + Batch API for the monthly fan-out.
- Human-in-the-loop option: "draft → review → send" toggle per client.
**Acceptance criteria:**
- [ ] Reports generate and email automatically for all retainer clients with no manual assembly.
- [ ] A report never includes another client's data (tested).
- [ ] Metric movements in the narrative match the dashboard exactly.

---

## 8. Data Model (core schema, Postgres)

> Indicative — refine in implementation. **Every tenant-scoped table carries `tenant_id`/`client_id` as the leading column of a composite index** (RLS performance, §9). Org model: `organization` rows are tenants; the agency is one staff org, each client is its own org.

**Identity & tenancy:** `organization` (id, type=`agency|client`, name, branding) · `user` · `membership` (user_id, org_id, role=`founder|team|client`) · `audit_event`.

**Clients & CRM:** `client` (=client organization profile: services, account_manager_id, health, branding) · `client_contact` · `deal` (stage, value, services, next_action, source) · `deal_stage` · `contact` · `contract` · `contract_template` · `signature_event`.

**Work:** `board` · `column` · `task` (client_id, assignee_id, due, status, priority, origin=`agency|client`) · `task_comment` · `task_attachment` · `time_entry` (user_id, task_id, client_id, minutes, billable, source=`timer|manual`) · `cost_rate` (user_id, rate, effective_from).

**Connections & metrics:** `connection` (client_id, provider, status, last_sync_at, last_error) · `connection_account_map` (connection_id, external_account_id, kind) · `oauth_token` (vault-backed) · `webhook_endpoint` · `metric_daily` (client_id, provider, account_id, entity, date, metric, value, is_provisional) · `metric_monthly_rollup` · `raw_event`.

**Leads:** `lead` (client_id, source, source_external_id, occurred_at, contact{name,email,phone_e164}, attribution{channel,campaign,ad_id,form_id,gclid,utm_*}, lead_type, value, status, is_spam, raw_event_id) · `lead_identity` (cross-source merge links).

**Finance:** `customer` (client_id, stripe_customer_id, gocardless_customer_id?, default_currency, vat_number, billing_address) · `invoice` (client_id, type=`retainer|one_off`, status, currency, subtotal, tax_total, total, amount_paid, due_date, issued_at, paid_at, provider, provider_invoice_id, hosted_url, pdf_url, subscription_id?) · `line_item` · `payment` (invoice_id, provider, provider_payment_id, amount, status, method, paid_at, fee_amount) · `subscription`/`retainer` (client_id, provider_subscription_id, amount, interval, day_of_month, status, current_period_*) · `revenue_target`.

**Files/approvals/messaging/notifications:** `file_asset` · `approval` · `approval_comment` · `conversation` (type=`dm|channel`, client_id?) · `conversation_member` · `message` · `read_receipt` · `notification` · `notification_pref` · `skill_doc`.

**Reports:** `report` (client_id, period, status, pdf_url, generated_at, model_used).

---

## 9. Multi-tenancy, Security & Compliance

- **Tenant isolation = Postgres Row-Level Security** keyed on `tenant_id`/`organization_id`, driven by JWT claims (`organization_id` + `app_role`) injected via a Custom Access Token hook — **plus** app-level query scoping (defense in depth). Secure-by-default: no context → zero rows.
- **RBAC** via an `authorize()` `SECURITY DEFINER` function inside RLS policies. Roles from **`app_metadata` only** (never user-editable `user_metadata`). Staff org = cross-client read; client orgs = portal-scoped.
- **Performance rule:** composite indexes **leading with `tenant_id`** on every tenant table (RLS is ~100× slower otherwise); load-test.
- **Token vault:** per-client OAuth/refresh + System-User tokens encrypted at rest (Supabase Vault / KMS), accessed only by server-side service-role functions; rotation, revocation, reuse detection. Never expose tokens to the browser. `service_role` is never used for user-facing queries.
- **Caching safety:** Next.js App Router must render tenant data **dynamically** (no shared cache keyed only by URL) to prevent cross-tenant leakage. *(**React + Supabase implementation:** our Vite SPA has no server-rendered tenant pages — tenant scope comes from the authenticated Supabase session + RLS on every query. Do not cache tenant data in module-level singletons, `localStorage`, or service workers keyed only by URL.)*
- **PII/GDPR:** leads carry names/emails/phones — encrypt, scope per tenant, honour deletion, don't log raw PII. UK/EU data handling.
- **Audit log** for money/security events (§5.14).
- **Automated cross-tenant test suite** is a release gate.

---

## 10. Tech Stack & Infrastructure

> **Implementation decision (v2.1):** We are building on **React + Supabase**, evolving the existing `riftly-dashboard` repo. The table below preserves the original v2.0 research/spec; the **→ chosen** column is what we are actually using. See also §0.1.

| Layer | Choice (v2.0 spec) | Rationale / main trade-off | → chosen (v2.1) |
|---|---|---|---|
| Framework | **Next.js 16 (App Router) + TypeScript (strict)** on Vercel | One typed codebase for internal app + portal; Server Components stream the shell. Disable caching on tenant data. | **React (Vite) + TypeScript (strict) + react-router-dom** — internal app + client portal in one SPA |
| DB | **Postgres on Supabase** (Neon = alt) | Bundles Auth + RLS + Storage + Vault; less glue. Keep SQL portable via Drizzle. | **Postgres on Supabase** ✓ |
| Tenant isolation | **Postgres RLS** + app scoping | DB-enforced; needs tenant-leading indexes. | **Postgres RLS** + app scoping ✓ |
| ORM | **Drizzle** | SQL-first, tiny, instant types, great for analytics JOINs; thinner migration GUI than Prisma. | **Supabase SQL migrations** + generated types (`database.types.ts`); Drizzle optional later |
| Auth | **Supabase Auth** (Clerk = swap-in) | One identity for staff + clients; deep RLS integration; lowest cost as client logins grow. Build the B2B org/invite UI yourself (or use Clerk for polish at per-MAU/MAO cost). | **Supabase Auth** ✓ |
| UI | **Tailwind + shadcn/ui** | Conventional, owned components Claude knows well. | **Tailwind + shadcn/ui** ✓ |
| Kanban | **dnd-kit** | Accessible, performant drag-drop. | **dnd-kit** (upgrade from current HTML5 drag) |
| Charts | **Recharts** (shadcn charts) | Lighter than Tremor, full Tailwind control. | **Recharts** ✓ |
| Jobs/schedule | **Inngest** | Durable step functions + cron + retries for ETL + monthly reports; avoid bare Vercel Cron. | **Inngest** and/or **Supabase Edge Functions** + `pg_cron` |
| Email | **Resend** (+ React Email) | Typed templates; warm up a sending domain. | **Resend** (+ React Email) |
| PDF | **@react-pdf/renderer** | Serverless-friendly; Playwright+chromium fallback if pixel-exact HTML needed. | **@react-pdf/renderer** (run in Edge Function / worker) |
| Secrets/token vault | **Supabase Vault** (+ Vercel env for app secrets) | Encrypted per-client tokens via service-role RPC. | **Supabase Vault** + env secrets on host/Edge Functions |
| AI | **Anthropic TS SDK** — `claude-opus-4-8` / `claude-sonnet-4-6` / `claude-haiku-4-5` | Model routing + prompt caching + Batch API for cost control. | **Anthropic TS SDK** (server-side / Edge Function) |
| Hosting | **Vercel** | Native Next.js; preview deploys; push long work into Inngest. | **Vercel/Netlify** (static React build) + **Supabase** (DB/Auth/Functions) |
| Payments | **Stripe** (GoCardless Phase 3) | Billing + Invoicing + Tax + webhooks. | **Stripe** ✓ |

> **MCP is for development, not runtime:** use Supabase/shadcn/Vercel/Figma MCPs to help Claude scaffold, query, pull components, and deploy. Production code uses vendor SDKs and our connectors.

---

## 11. Non-functional Requirements
- **Performance:** cached dashboard reads < 1.5s p95; no external API calls on page render.
- **Reliability:** sync jobs idempotent, retried, observable; per-client/per-provider sync status + last-success timestamp surfaced; alert on failure or quota near 100%.
- **Data freshness SLA:** external metrics ≤ 24h stale (last 3 days flagged provisional); payments reconciled ≤ 5 min.
- **Security:** RLS + audit + encrypted tokens; cross-tenant test suite green before release.
- **Observability:** structured logs, sync dashboards, AI token/cost telemetry, rate-limit headroom (Meta BUC %, GA4 PropertyQuota).
- **Accessibility:** WCAG AA on portal-facing flows.
- **Versioning:** pin Google Ads / Meta Graph API versions; quarterly upgrade task.

---

## 12. Phased Delivery Plan

**Phase 1 — Operations Core (no external approvals required):**
Auth + roles + RLS tenancy · organizations/clients model · Tasks (Kanban + time tracking, two-way client) · CRM pipeline · Client accounts · Finance dashboard + **Stripe invoicing & payments** · Client portal shell (tasks + invoices) · Connections framework (stubbed) · Notifications + audit · Skills library. **Ships a genuinely usable product.**
*(In parallel: kick off ALL §6.4 approvals on Day 1.)*

**Phase 2 — Data & Intelligence:**
Connectors: GA4 → GSC → Google Ads → Meta → GBP (in approval-readiness order) · Token vault + sync scheduler + metrics store · Unified Leads inbox · Analytics aggregator (cross-client + portal) · **AI monthly report generator** · Onboarding wizard + connection-health dashboard.

**Phase 3 — Scale & Polish:**
Time → profitability reporting · Messaging (DMs + channels) · Contracts/proposals + e-sign · Approvals & file sharing · "Ask-your-data" AI chat · Optional Looker Studio embeds · GoCardless Direct Debit · white-label refinements.

---

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Ad/analytics API approvals slip (Google Ads backlog, Meta verification, GBP two-gate) | Phase 2 delayed | Apply Day 1; launch Phase 1 independent of them; use Google Ads **Explorer** tier for early data; per-provider readiness order. |
| Tokens silently expire/revoked | Client dashboard goes blank | Connection-health monitor + alerts + reconnect flow; token health checks each sync. |
| Cross-tenant data leak | Severe (trust/legal) | RLS + app scoping + tenant-leading indexes + automated cross-tenant test gate; no MCP on data path. |
| Metric discrepancies vs platform UIs | Client disputes | Data-trust rules (§6.5): provisional flags, caveats, "verify in platform", raw audit. |
| Lead double-counting across sources | Inflated numbers | Deterministic dedupe (E.164 phone → email) + identity links + per-client lead definition. |
| LLM cost creep | Margin | Confine LLM to monthly report; model routing + prompt caching + Batch API; never MCP on hot path. |
| Messaging scope creep (Slack rebuild) | Wasted effort | Hard scope guard; ship DMs + channels only. |
| API version sunsets | Breakage | Pin versions behind connector interface; quarterly upgrade task. |

---

## 14. Open Questions (to confirm during build)
1. **Approximate client count and team size** — sizes rate-limit batching, OAuth onboarding UX, and Clerk-vs-Supabase-Auth cost. *(Still outstanding from kickoff.)*
2. ~~**The existing live build / repo** — to inspect for reusable UI before greenfield.~~ **Resolved (v2.1):** we are evolving **`riftly-dashboard`** in place — React (Vite) + Supabase. Reuse existing UI, migrations, and auth; do not greenfield Next.js.
3. **E-sign provider** for §5.10 (build-in vs integrate).
4. **Call-tracking** — does the agency use CallRail/WhatConverts today (affects leads scope)?
5. **White-label depth** for the client portal (custom domains per client?).
6. Whether any Team members need **finance/invoicing edit** rights (permission defaults).

---

## 15. Appendix — Key API & Doc References
- GA4 Data/Admin API: developers.google.com/analytics · quotas: …/data/v1/quotas
- Search Console API: developers.google.com/webmaster-tools · perf data deep-dive (anonymization/limits)
- Google Ads API access levels: developers.google.com/google-ads/api/docs/access-levels · official MCP: …/developer-toolkit/mcp-server · Feb-2026 token backlog note
- Meta Marketing API + Lead Ads: developers.facebook.com/docs/marketing-api · System Users · leadgen webhooks · 2026 attribution/retention changes · official Meta Ads MCP (Apr 2026)
- Google Business Profile: developers.google.com/my-business (Performance API, prereqs/approval, v4 reviews, Q&A sunset)
- Looker Studio embed RLS: developers.google.com/looker-studio/connector/embed-row-level-security · Data Studio API limits · enterprise Looker MCP (preview)
- Stripe: docs.stripe.com/invoicing, /billing/subscriptions, /tax · GoCardless: developer.gocardless.com
- Supabase RLS/RBAC/Vault: supabase.com/docs · Inngest · Resend · Anthropic platform docs (models/pricing)

*(Full source URLs are captured in the research artifact accompanying this PRD.)*

---

*End of PRD v2.1.*
