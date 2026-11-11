-- Phase 11: the pre-run demo campaign (backend plan §21). Jobs made by scripts/seed_demo.py are
-- marked so every page about them says the candidates are synthetic.
alter table jobs add column is_demo boolean not null default false;
