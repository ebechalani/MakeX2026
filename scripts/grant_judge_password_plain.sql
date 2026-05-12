-- Grant the anon role read access to password_plain on judges table
GRANT SELECT (password_plain) ON judges TO anon;
