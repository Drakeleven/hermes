-- 1. Create the configs table
create table if not exists configs (
  key text primary key,
  value jsonb not null,
  updated_at timestamp with time zone default now()
);

-- 2. Enable Row Level Security (RLS) - recommended for safety
alter table configs enable row level security;

-- 3. Allow public read access to configs (if you want everyone to see them)
--    If only authenticated users should read, change 'anon' to 'authenticated'
create policy "Allow public read access" on configs
  for select using (true);

-- 4. Insert default configuration
insert into configs (key, value)
values (
  'app_settings',
  '{
    "app_name": "Jadwal Shift Bulanan",
    "max_shifts_default": 18,
    "shifts_per_type": 6,
    "allowed_streak": 3,
    "lookback_days": 2
  }'
)
on conflict (key) do update set value = excluded.value;
