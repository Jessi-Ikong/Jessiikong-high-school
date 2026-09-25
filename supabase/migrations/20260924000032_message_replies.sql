-- 32. Replying to (quoting) a specific message, like WhatsApp's reply.
--
--   * messages.reply_to_message_id: the message being replied to (optional).
--     If the quoted message were ever deleted (there is no delete feature),
--     the reply keeps its own text and simply loses the quote (set null).
--   * It must be a message in the SAME conversation; anything else (another
--     conversation, or an id that doesn't exist) is refused with
--     "You can only reply to a message in the same conversation." - the same
--     answer in both cases, so it can't be used to probe other threads.
--   * A reply is just a new message, so every sending rule still applies:
--     read-only threads (migration 13), 1-2,000 characters (31), sender and
--     sent time set by the database (31).
--   * It can't be changed afterwards: migration 31 only lets the TEXT of a
--     message be edited, so a reply can't be re-pointed, and a plain message
--     can't become a reply later.
--   * The quote is NOT a copy: the page shows the quoted message's CURRENT
--     text (marked "edited" if it was edited). Nothing is duplicated.

alter table public.messages
  add column reply_to_message_id uuid references public.messages (id) on delete set null;

create index messages_reply_to_idx on public.messages (reply_to_message_id) where reply_to_message_id is not null;

-- Same as migration 31, plus the same-conversation check for replies.
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
  if new.reply_to_message_id is not null and not exists (
    select 1 from public.messages m
     where m.id = new.reply_to_message_id and m.thread_id = new.thread_id
  ) then
    raise exception 'You can only reply to a message in the same conversation.';
  end if;
  return new;
end;
$$;
