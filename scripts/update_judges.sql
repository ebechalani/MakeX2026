-- Run this in the Supabase SQL editor (bypasses RLS)
-- Step 1: add password_plain column if it doesn't exist
ALTER TABLE judges ADD COLUMN IF NOT EXISTS password_plain TEXT;

-- Step 2: update name, username, and password_plain for all 17 judges
-- Matched by old username (judge-1 through judge-17)
UPDATE judges SET name='csoccer1',  username='csoccer1',  password_plain='QKJNBRZ'  WHERE username IN ('judge-1',  'csoccer1');
UPDATE judges SET name='csoccer2',  username='csoccer2',  password_plain='YDMXAMU'  WHERE username IN ('judge-2',  'csoccer2');
UPDATE judges SET name='cinspire1', username='cinspire1', password_plain='DVH3EHF'  WHERE username IN ('judge-3',  'cinspire1');
UPDATE judges SET name='cinspire2', username='cinspire2', password_plain='6KWQ3EF'  WHERE username IN ('judge-4',  'cinspire2');
UPDATE judges SET name='cinspire3', username='cinspire3', password_plain='VGVRGR9'  WHERE username IN ('judge-5',  'cinspire3');
UPDATE judges SET name='cinspire4', username='cinspire4', password_plain='2QTJ9C5'  WHERE username IN ('judge-6',  'cinspire4');
UPDATE judges SET name='cinspire5', username='cinspire5', password_plain='44JAKSY'  WHERE username IN ('judge-7',  'cinspire5');
UPDATE judges SET name='cinspire6', username='cinspire6', password_plain='RVQPBGN'  WHERE username IN ('judge-8',  'cinspire6');
UPDATE judges SET name='cinspire7', username='cinspire7', password_plain='DCZQR3Q'  WHERE username IN ('judge-9',  'cinspire7');
UPDATE judges SET name='cstarter1', username='cstarter1', password_plain='RH9S9UR'  WHERE username IN ('judge-10', 'cstarter1');
UPDATE judges SET name='cstarter2', username='cstarter2', password_plain='TD2NAVQ'  WHERE username IN ('judge-11', 'cstarter2');
UPDATE judges SET name='minspire1', username='minspire1', password_plain='46VE8DW'  WHERE username IN ('judge-12', 'minspire1');
UPDATE judges SET name='minspire2', username='minspire2', password_plain='X628HAU'  WHERE username IN ('judge-13', 'minspire2');
UPDATE judges SET name='minspire3', username='minspire3', password_plain='BPPVX5U'  WHERE username IN ('judge-14', 'minspire3');
UPDATE judges SET name='minspire4', username='minspire4', password_plain='3SS7WTC'  WHERE username IN ('judge-15', 'minspire4');
UPDATE judges SET name='minspire5', username='minspire5', password_plain='ZA72XXU'  WHERE username IN ('judge-16', 'minspire5');
UPDATE judges SET name='mstarter',  username='mstarter',  password_plain='WFSRGAU'  WHERE username IN ('judge-17', 'mstarter');

-- Verify
SELECT name, username, password_plain FROM judges ORDER BY username;
