# NG Property ERP SaaS V1

## Presentation
NG Property ERP is a local-first and cloud-ready SaaS for property management, built for enterprise workflows around buildings, units, tenants, leases, invoices, payments, cash, stock, maintenance, reports, communication, workflows, HR, and settings.

## Goals
- Keep the product compact, dense, and fast for daily operator use.
- Preserve the validated visual identity unless a request explicitly asks for a targeted polish.
- Keep local and production behavior aligned across PostgreSQL, Railway, Vercel, and Supabase.

## Technical Stack
- Frontend: React, Vite, TypeScript, React Router, Axios.
- Backend: NestJS, PostgreSQL.
- Storage and cloud target: Supabase PostgreSQL and Supabase Storage.
- Reporting and export: CSV, Excel, print-friendly pages, and PDF-ready layouts when available.

## Multi-tenant Rules
- `organization_id` is mandatory on business records.
- The backend is the source of truth for authorization and tenant isolation.
- The frontend must never invent or send `organization_id` manually.
- Deleted business data is soft-deleted when the model supports it.

## UI and UX Conventions
- Prefer compact pages, compact tables, sticky headers, and visible filters.
- Keep KPI bands, clear detail pages, and direct export actions.
- Use modal or drawer forms for creation when that keeps the list view fast.
- Use searchable selects for long reference lists and simple selects for short fixed lists.
- Keep amount and currency separated in tables when money is displayed.
- Keep status badges consistent with the platform colors.

## Business Rules
- Buildings contain units.
- Units can have lease history.
- Leases are the center of occupancy and guarantee tracking.
- Invoices are linked to leases and/or tenants through the active lease context.
- Payments update invoice balances and can create cash movements.
- Communication actions are simulated locally when providers are not connected.

## Current Module Status
- Dashboard: available and used as BI dashboard.
- Activity Center: available as the daily cockpit.
- Buildings: enterprise list, report, and detail work are active.
- Units: enterprise detail and export work are active.
- Tenants: physical and company support is active.
- Leases: enterprise structure and guarantee flow are active.
- Invoices: enterprise V2 polish is in progress and detail pages are highly featured.
- Payments: enterprise V2 polish is active.
- Cash, Stock, Maintenance, Workflows, Communication, Settings, Reports, HR: available and progressively hardened.

## Development Conventions
- Use `apply_patch` for code edits.
- Keep backend endpoints backward compatible when possible.
- Reuse existing API helpers and UI components before adding new abstractions.
- Prefer direct, readable changes over large refactors unless a refactor is explicitly requested.

## Never Change Without Validation
- Sidebar, topbar, and overall visual identity.
- Existing route structure unless the change is explicitly requested.
- Multi-tenant isolation and permission enforcement.
- Cloud deployment contracts and environment variable names.

## New Chat Handoff Procedure
1. Read this file first.
2. Inspect the affected module and its backend endpoint before editing.
3. Make the smallest change that satisfies the request.
4. Build frontend and backend when relevant.
5. Report the exact files changed and any notable test or build warnings.
