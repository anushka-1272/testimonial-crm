-- Reward item chosen at post-interview completion; copied to dispatch when shipped.

alter table public.interviews
  add column if not exists reward_item text;

alter table public.dispatch
  add column if not exists reward_item text;

comment on column public.interviews.reward_item is
  'Physical reward (e.g. AirPods, JBL Clip 5) or No Dispatch when eligible without shipment.';
comment on column public.dispatch.reward_item is
  'Reward item to ship; set when dispatch row is created from post-interview flow.';
