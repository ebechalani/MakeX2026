-- Run this in the Supabase SQL editor (authenticated role bypasses RLS)
INSERT INTO judges (name, username, password_hash) VALUES
  ('Judge 1', 'judge-1', extensions.crypt('QKJNBRZ', extensions.gen_salt('bf', 10))),
  ('Judge 2', 'judge-2', extensions.crypt('YDMXAMU', extensions.gen_salt('bf', 10))),
  ('Judge 3', 'judge-3', extensions.crypt('DVH3EHF', extensions.gen_salt('bf', 10))),
  ('Judge 4', 'judge-4', extensions.crypt('6KWQ3EF', extensions.gen_salt('bf', 10))),
  ('Judge 5', 'judge-5', extensions.crypt('VGVRGR9', extensions.gen_salt('bf', 10))),
  ('Judge 6', 'judge-6', extensions.crypt('2QTJ9C5', extensions.gen_salt('bf', 10))),
  ('Judge 7', 'judge-7', extensions.crypt('44JAKSY', extensions.gen_salt('bf', 10))),
  ('Judge 8', 'judge-8', extensions.crypt('RVQPBGN', extensions.gen_salt('bf', 10))),
  ('Judge 9', 'judge-9', extensions.crypt('DCZQR3Q', extensions.gen_salt('bf', 10))),
  ('Judge 10', 'judge-10', extensions.crypt('RH9S9UR', extensions.gen_salt('bf', 10))),
  ('Judge 11', 'judge-11', extensions.crypt('TD2NAVQ', extensions.gen_salt('bf', 10))),
  ('Judge 12', 'judge-12', extensions.crypt('46VE8DW', extensions.gen_salt('bf', 10))),
  ('Judge 13', 'judge-13', extensions.crypt('X628HAU', extensions.gen_salt('bf', 10))),
  ('Judge 14', 'judge-14', extensions.crypt('BPPVX5U', extensions.gen_salt('bf', 10))),
  ('Judge 15', 'judge-15', extensions.crypt('3SS7WTC', extensions.gen_salt('bf', 10))),
  ('Judge 16', 'judge-16', extensions.crypt('ZA72XXU', extensions.gen_salt('bf', 10))),
  ('Judge 17', 'judge-17', extensions.crypt('WFSRGAU', extensions.gen_salt('bf', 10)));