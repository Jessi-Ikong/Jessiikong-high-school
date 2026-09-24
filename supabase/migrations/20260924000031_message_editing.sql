-- 31. Editing messages: by the sender only, within 1 hour of sending.
--
--   * messages.edited_at: when the text was last edited (null = never). Set
--     by the database, never by the client. No edit history is kept.
--   * The SENDER may change the TEXT (body) of their own message while
--       - it was sent less than 1 hour ago (sent_at + 1 hour), and
--       - the thread is still writable (the teacher still teaches one of the
--         parent's children a subject in the current session, migration 13).
--     Otherwise: "Messages can only be edited within 1 hour of sending." /
--     the read-only message. Nothing else about a message can be changed
--     (thread, sender, sent time); the recipient may still only mark it read.
--   * Same content rules for new messages and edits: 1-2,000 characters
--     (non-empty was already enforced; the 2,000 limit is new, in the
--     database, for both).
--   * Audit: the generic trigger (migration 19) never copies message text.
--     Before, an update that changed only the text would not have been
--     logged at all; now each edit changes edited_at, so it is logged as
--     update_messages with the message id, the editor and edited_at
--     (old -> new) - still without any text.

alter table public.messages add column edited_at timestamptz;

alter table public.messages
  add constraint messages_body_max_length check (char_length(body) <= 2000);

-- New messages: sender forced to the signed-in user (unchanged); sent_at is
-- set by the database (a client could otherwise post a message "sent" in the
-- future and keep it editable for as long as it liked); edited_at can't be
-- pre-filled.
create or replace function private.validate_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.sender_id := private.current_user_id();
    new.sent_at := now();
  end if;
  new.edited_at := null;
  if not exists (
    select 1
      from public.message_threads mt
      join public.parents p on p.id = mt.parent_id
      join public.teachers t on t.id = mt.teacher_id
     where mt.id = new.thread_id
       and new.sender_id in (p.user_id, t.user_id)
  ) then
    raise exception 'Sender is not a participant in this thread';
  end if;
  return new;
end;
$$;

-- Updates: the recipient may mark read; the sender may edit the text within
-- the rules above. Everything else stays fixed.
create or replace function private.protect_message_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid;
begin
  if auth.uid() is null then
    return new;   -- server-side code
  end if;
  v_me := private.current_user_id();

  -- Thread, sender and sent time can never change.
  if (to_jsonb(new) - 'read_at' - 'body' - 'edited_at') is distinct from (to_jsonb(old) - 'read_at' - 'body' - 'edited_at') then
    raise exception 'Only the text of a message can be edited.' using errcode = '42501';
  end if;

  -- Marking read: recipient only (unchanged rule).
  if new.read_at is distinct from old.read_at and old.sender_id = v_me then
    raise exception 'Only the recipient can mark a message as read' using errcode = '42501';
  end if;

  if new.body is distinct from old.body then
    if old.sender_id is distinct from v_me then
      raise exception 'Only the sender can edit a message.' using errcode = '42501';
    end if;
    if now() > old.sent_at + interval '1 hour' then
      raise exception 'Messages can only be edited within 1 hour of sending.';
    end if;
    if not private.thread_is_linked(old.thread_id) then
      raise exception 'This conversation is read-only (there is no shared class this session), so its messages can no longer be edited.';
    end if;
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;   -- the client can't set it
  end if;
  return new;
end;
$$;

-- RLS backstop: a participant may update (the trigger above decides what);
-- the sender's own updates must also be inside the window of a writable thread.
drop policy "messages: participants mark as read" on public.messages;

create policy "messages: recipient marks read, sender edits within 1 hour"
  on public.messages for update to authenticated
  using (private.is_thread_participant(thread_id))
  with check (
    private.is_thread_participant(thread_id)
    and (
      sender_id is distinct from (select private.current_user_id())
      or (sent_at > now() - interval '1 hour' and private.thread_is_linked(thread_id))
    )
  );
