-- 40. Content for the school's PUBLIC website: news & events, a photo
--     gallery, and admissions inquiries from prospective families.
--
-- Separate from the internal school system. Access:
--   news_posts, gallery_photos
--     * anyone (signed out too) can read PUBLISHED items; a news post also
--       has to have reached its published_at (so a post can be scheduled);
--     * admins (both tiers) read and manage everything, drafts included.
--   admissions_inquiries (contact details of families: sensitive)
--     * anyone can SUBMIT one (insert only: status 'new', no internal notes);
--     * nobody but admins can read, change or delete them. The public form
--       inserts without reading the row back (return=minimal).
--     * a simple brake on repeated submissions: at most 3 per email address
--       per hour.
--   Storage: a PUBLIC bucket "gallery" (marketing images: anyone can view a
--   file by its URL), 10 MB max, JPEG / PNG / WebP only. Only admins can
--   upload, replace or delete files; nobody else can list them. Paths:
--   photos/<file> (gallery) and news/<file> (news cover images).
--
-- Signed-out visitors (the anon role) can't use the private.* helpers, so
-- the read policies for them are separate and don't call is_admin().
--
-- Audit: migration 19 attached the generic audit trigger once, to the tables
-- that existed then, so it is attached to these three new tables here.
-- Inquiries submitted by the public are logged with no user (user_id null).

-- ---------------------------------------------------------------------------
-- News & events
-- ---------------------------------------------------------------------------
create table public.news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> '' and length(title) <= 200),
  body text not null check (btrim(body) <> '' and length(body) <= 20000),
  cover_image_url text check (cover_image_url ~ '^news/[A-Za-z0-9._-]{1,120}$'),
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_published or published_at is not null)
);
comment on column public.news_posts.cover_image_url is 'Path inside the public "gallery" storage bucket (news/<file>), or null.';
create index news_posts_published_idx on public.news_posts (published_at desc) where is_published;

-- ---------------------------------------------------------------------------
-- Photo gallery
-- ---------------------------------------------------------------------------
create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  image_url text not null check (image_url ~ '^photos/[A-Za-z0-9._-]{1,120}$'),
  caption text check (length(caption) <= 300),
  category text not null default 'Events'
    check (category in ('Events', 'Facilities', 'Sports', 'Academics', 'Other')),
  display_order integer not null default 0,
  is_published boolean not null default false,
  uploaded_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.gallery_photos.image_url is 'Path inside the public "gallery" storage bucket (photos/<file>).';
create index gallery_photos_order_idx on public.gallery_photos (display_order, created_at);

-- ---------------------------------------------------------------------------
-- Admissions inquiries
-- ---------------------------------------------------------------------------
create table public.admissions_inquiries (
  id uuid primary key default gen_random_uuid(),
  parent_name text not null check (btrim(parent_name) <> '' and length(parent_name) <= 120),
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text check (length(phone) <= 30),
  child_name text not null check (btrim(child_name) <> '' and length(child_name) <= 120),
  desired_class text not null check (btrim(desired_class) <> '' and length(desired_class) <= 60),
  message text check (length(message) <= 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'enrolled', 'declined')),
  internal_notes text check (length(internal_notes) <= 5000),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.admissions_inquiries.internal_notes is 'Staff-only notes. Never shown to the public.';
create index admissions_inquiries_submitted_idx on public.admissions_inquiries (submitted_at desc);
create index admissions_inquiries_email_idx on public.admissions_inquiries (lower(email), submitted_at);

-- ---------------------------------------------------------------------------
-- Stamps and small rules (triggers)
-- ---------------------------------------------------------------------------
-- News: author on create; published_at filled in the first time a post is
-- published (an admin may set or change it, e.g. to schedule or reorder).
create function private.stamp_news_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(private.current_user_id(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.is_published and new.published_at is null then
    new.published_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger news_posts_stamp
  before insert or update on public.news_posts
  for each row execute function private.stamp_news_post();

create function private.stamp_gallery_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(private.current_user_id(), new.uploaded_by);
    new.created_at := now();
  else
    new.uploaded_by := old.uploaded_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger gallery_photos_stamp
  before insert or update on public.gallery_photos
  for each row execute function private.stamp_gallery_photo();

-- Inquiries: the submission time is always "now" and can't be changed;
-- trimmed fields; at most 3 per email address per hour. (Unconditional:
-- signed-out visitors have no auth.uid(), so "no user" can't be treated as
-- trusted server code here.)
create function private.stamp_admissions_inquiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.submitted_at := now();
    new.email := lower(btrim(new.email));
    new.parent_name := btrim(new.parent_name);
    new.child_name := btrim(new.child_name);
    new.desired_class := btrim(new.desired_class);
    new.phone := nullif(btrim(coalesce(new.phone, '')), '');
    new.message := nullif(btrim(coalesce(new.message, '')), '');
    if (select count(*) from public.admissions_inquiries i
         where lower(i.email) = new.email and i.submitted_at > now() - interval '1 hour') >= 3 then
      raise exception 'We have already received several inquiries from this email address in the last hour. We will be in touch soon.'
        using errcode = 'P0001';
    end if;
  else
    new.submitted_at := old.submitted_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger admissions_inquiries_stamp
  before insert or update on public.admissions_inquiries
  for each row execute function private.stamp_admissions_inquiry();

-- ---------------------------------------------------------------------------
-- Row rules (RLS)
-- ---------------------------------------------------------------------------
alter table public.news_posts enable row level security;
alter table public.gallery_photos enable row level security;
alter table public.admissions_inquiries enable row level security;

-- News
create policy "news_posts: public reads published"
  on public.news_posts for select to anon
  using (is_published and published_at <= now());
create policy "news_posts: signed-in read published, admins read all"
  on public.news_posts for select to authenticated
  using ((is_published and published_at <= now()) or (select private.is_admin()));
create policy "news_posts: admins create"
  on public.news_posts for insert to authenticated with check ((select private.is_admin()));
create policy "news_posts: admins edit"
  on public.news_posts for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "news_posts: admins delete"
  on public.news_posts for delete to authenticated using ((select private.is_admin()));

-- Gallery
create policy "gallery_photos: public reads published"
  on public.gallery_photos for select to anon
  using (is_published);
create policy "gallery_photos: signed-in read published, admins read all"
  on public.gallery_photos for select to authenticated
  using (is_published or (select private.is_admin()));
create policy "gallery_photos: admins add"
  on public.gallery_photos for insert to authenticated with check ((select private.is_admin()));
create policy "gallery_photos: admins edit"
  on public.gallery_photos for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "gallery_photos: admins delete"
  on public.gallery_photos for delete to authenticated using ((select private.is_admin()));

-- Inquiries: anyone submits; only admins read / manage.
create policy "admissions_inquiries: anyone can submit"
  on public.admissions_inquiries for insert to anon, authenticated
  with check (status = 'new' and internal_notes is null);
create policy "admissions_inquiries: admins read"
  on public.admissions_inquiries for select to authenticated using ((select private.is_admin()));
create policy "admissions_inquiries: admins update"
  on public.admissions_inquiries for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admissions_inquiries: admins delete"
  on public.admissions_inquiries for delete to authenticated using ((select private.is_admin()));

-- Signed-out visitors only ever need these two privileges here.
revoke all on public.news_posts, public.gallery_photos, public.admissions_inquiries from anon;
grant select on public.news_posts, public.gallery_photos to anon;
grant insert on public.admissions_inquiries to anon;

-- ---------------------------------------------------------------------------
-- Storage: public "gallery" bucket, admins write
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- photos/<file> or news/<file>
create function private.is_gallery_path(p_name text)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_name ~ '^(photos|news)/[A-Za-z0-9._-]{1,120}$'
$$;

create policy "gallery files: admins see"
  on storage.objects for select to authenticated
  using (bucket_id = 'gallery' and (select private.is_admin()));
create policy "gallery files: admins upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery' and (select private.is_admin()) and private.is_gallery_path(name));
create policy "gallery files: admins replace"
  on storage.objects for update to authenticated
  using (bucket_id = 'gallery' and (select private.is_admin()))
  with check (bucket_id = 'gallery' and (select private.is_admin()) and private.is_gallery_path(name));
create policy "gallery files: admins delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'gallery' and (select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Audit (the generic trigger from migration 19)
-- ---------------------------------------------------------------------------
create trigger audit_changes after insert or update or delete on public.news_posts
  for each row execute function private.audit_row_change();
create trigger audit_changes after insert or update or delete on public.gallery_photos
  for each row execute function private.audit_row_change();
create trigger audit_changes after insert or update or delete on public.admissions_inquiries
  for each row execute function private.audit_row_change();

notify pgrst, 'reload schema';
