-- Manual RLS check — paste into Supabase Dashboard > SQL Editor and click Run.
--
-- BEFORE RUNNING: create a throwaway login in Authentication > Users >
-- "Add user" > "Create new user" (any email/password, tick "Auto Confirm User"),
-- copy its "User UID", and paste it below in place of PASTE-USER-UID-HERE.
--
-- NOTHING IS SAVED. The script deliberately ends with an error whose message
-- is the test report; the error makes Postgres undo every change it made.
-- So a red box is expected — read the text inside it.

do $$
declare
  v_uid uuid := 'PASTE-USER-UID-HERE';
  v_session uuid;
  v_term uuid;
  v_class uuid;
  v_result text;
  v_count integer;
  v_report text := '';
  v_passed integer := 0;
begin
  -- Setup (runs as the database owner): a session, term, class, and a
  -- LIMITED admin profile linked to the login above.
  insert into public.sessions (name, start_date, end_date)
    values ('RLS-TEST', '2099-09-01', '2100-07-31') returning id into v_session;
  insert into public.terms (session_id, name, term_number, start_date, end_date)
    values (v_session, 'RLS-TEST term', 1, '2099-09-01', '2099-12-15') returning id into v_term;
  insert into public.classes (name, level)
    values ('RLS-TEST class', 999) returning id into v_class;
  insert into public.users (auth_id, role, admin_level, first_name, last_name)
    values (v_uid, 'admin', 'limited_admin', 'Rls', 'Tester');

  -- Act as that login from now on (exactly what the app does).
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Check 1: a limited admin must NOT be able to create a fee structure.
  execute 'set local role authenticated';
  begin
    insert into public.fee_structures (class_id, term_id, name, amount)
      values (v_class, v_term, 'RLS-TEST fee', 1000);
    v_result := 'ALLOWED';
  exception when others then
    v_result := 'BLOCKED (' || sqlerrm || ')';
  end;
  execute 'reset role';
  v_report := v_report || E'\n1) Limited admin adds a fee structure -> expected BLOCKED, got ' || v_result
    || case when v_result like 'BLOCKED%' then '  PASS' else '  FAIL' end;
  v_passed := v_passed + (v_result like 'BLOCKED%')::int;

  -- Check 2: a limited admin must NOT be able to create another admin.
  execute 'set local role authenticated';
  begin
    insert into public.users (role, admin_level, first_name, last_name)
      values ('admin', 'limited_admin', 'Sneaky', 'Admin');
    v_result := 'ALLOWED';
  exception when others then
    v_result := 'BLOCKED (' || sqlerrm || ')';
  end;
  execute 'reset role';
  v_report := v_report || E'\n2) Limited admin creates an admin account -> expected BLOCKED, got ' || v_result
    || case when v_result like 'BLOCKED%' then '  PASS' else '  FAIL' end;
  v_passed := v_passed + (v_result like 'BLOCKED%')::int;

  -- Check 3: after becoming a SUPER admin, the same fee insert is allowed.
  -- (The promotion itself is done as the database owner, not as the user.)
  perform set_config('request.jwt.claims', '', true);
  update public.users set admin_level = 'super_admin' where auth_id = v_uid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.fee_structures (class_id, term_id, name, amount)
      values (v_class, v_term, 'RLS-TEST fee', 1000);
    v_result := 'ALLOWED';
  exception when others then
    v_result := 'BLOCKED (' || sqlerrm || ')';
  end;
  execute 'reset role';
  v_report := v_report || E'\n3) Super admin adds a fee structure -> expected ALLOWED, got ' || v_result
    || case when v_result = 'ALLOWED' then '  PASS' else '  FAIL' end;
  v_passed := v_passed + (v_result = 'ALLOWED')::int;

  -- Check 4: a signed-out visitor sees no user records at all.
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  select count(*) into v_count from public.users;
  execute 'reset role';
  v_report := v_report || E'\n4) Signed-out visitor counts rows in users -> expected 0, got ' || v_count
    || case when v_count = 0 then '  PASS' else '  FAIL' end;
  v_passed := v_passed + (v_count = 0)::int;

  raise exception '%', 'RLS CHECK FINISHED — ' || v_passed || ' of 4 passed. Nothing was saved.' || v_report;
end;
$$;
