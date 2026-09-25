-- 35. Make the "avatars" bucket PRIVATE (signed links only).
--
-- Student photos are minors' images; "public bucket with a random file name"
-- was security through obscurity. Now:
--   * The bucket is private: a photo can't be opened by its plain address,
--     guessed or not. Every view uses a short-lived SIGNED link.
--   * Who can get a signed link inside the app = who can READ the file in
--     storage: the person themselves, or an admin allowed to manage them
--     (the existing "avatars: see own / manageable files" rule, migration 34).
--     Uploading / replacing / deleting rules are unchanged.
--   * The public ID card check page has no login, so it can't sign links
--     itself. It now calls the Edge Function "verify-card", which (with the
--     service role) looks the card up by its random token and, ONLY if the card
--     is valid, signs THAT card's photo for 2 minutes. It takes a token, never
--     a photo path, so it can't be used to fetch any other photo.
--   * verify_id_card() is no longer callable by visitors or signed-in users
--     directly (only by the server, i.e. that Edge Function): it returns the
--     photo's storage path, which is useless without a signed link but has no
--     reason to be public.

update storage.buckets set public = false where id = 'avatars';

revoke execute on function public.verify_id_card(uuid) from public, anon, authenticated;
grant execute on function public.verify_id_card(uuid) to service_role;

notify pgrst, 'reload schema';
