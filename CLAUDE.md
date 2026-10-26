# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Claude Code specifics

- Path-scoped rules in `.claude/rules/` load automatically when you work on matching files. `money-safety.md` covers all of `apps/api`; read it before any change that could move money.
- `docs/PRD.pdf` is the source of truth for scope. When a request conflicts with it (for example, a money call that skips the rules engine), point to the conflict instead of silently complying.
- For PayPal integration code, use the APIMatic Context Plugin when it is installed, and record the prompts you used. That is evidence for the APIMatic prize (see `.claude/rules/apimatic.md`).
- PayPal sandbox API behavior is easy to misremember. Check endpoint shapes against PayPal's docs or the APIMatic plugin rather than recalling them.
