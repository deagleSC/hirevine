-- Extensions needed by Phase 1. pgvector is added with the AI tables (Phase 2/5).
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;
