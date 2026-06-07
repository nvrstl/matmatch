# Matmatch 🧘

A two-sided yoga marketplace for Belgium (Dutch). **Yoga teachers** build a profile and
set their availability; **yoga schools** browse them and send a **booking request** for a
specific date/time, which the teacher then **accepts or declines**. Rates are shown
(no in-app payment yet).

## Stack

- React 19 + Vite + TypeScript
- Tailwind CSS v4
- React Router
- Supabase (Auth + Postgres + Row Level Security)

## One-time setup

### 1. Create the database tables

The Supabase project URL + publishable key are already in [`.env`](.env). Now create the
schema:

1. Open your Supabase project → **SQL Editor**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) and **Run**.
   (Safe to re-run — it uses `if not exists` / `drop policy if exists`.)
3. Paste [`supabase/storage.sql`](supabase/storage.sql) and **Run** too — this creates the
   public `avatars` bucket used for teacher **profile photos**.

### 2. Turn OFF email confirmation (for the prototype)

Supabase by default emails a confirmation link before a user gets a session. Because the
app creates the user's profile row **right after sign-up** (which needs an active session),
disable confirmation while testing:

> Supabase → **Authentication → Sign In / Providers → Email** → turn **"Confirm email" OFF** → Save.

(For production you'd keep confirmation on and create the profile row after the user
confirms — e.g. via a database trigger on `auth.users`.)

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

## Try the full loop

1. **Sign up as a teacher** → fill in your profile (styles, city, rate), add availability
   slots, and hit **Publiceren**.
2. Open an incognito window and **sign up as a school**.
3. As the school: **Zoek leraren** → open the teacher → **Boekingsaanvraag sturen**.
4. Back as the teacher: **Boekingen** → **Accepteren** or **Weigeren**.
5. Both sides see the updated status.

## Project structure

```
src/
  lib/        supabase client, domain types, constants (NL), format helpers
  context/    AuthContext (session + profile + signUp/signIn/signOut)
  components/ Layout, Navbar, ProtectedRoute, BookingModal, ui primitives
  pages/      Landing, Signup, Login, TeacherProfile, BrowseTeachers,
              TeacherDetail, Bookings
supabase/
  schema.sql  tables + RLS policies (run once in the SQL Editor)
```

## Data model

- `profiles` — one per auth user, holds `role` (`teacher` | `school`) and name.
- `teacher_profiles` — bio, styles, languages, city, rate, `is_published`.
- `availability_slots` — weekly recurring availability per teacher.
- `school_profiles` — school name, city, etc.
- `bookings` — school → teacher request with `status`
  (`pending` → `accepted` / `declined` / `cancelled`).

RLS makes published teacher profiles world-readable and limits each booking to its two
parties.

## Likely next steps

- Email/PDF confirmation when a booking is accepted.
- School profile editor + photo upload (Supabase Storage).
- Specific (non-recurring) availability + conflict checking against accepted bookings.
- Payments (Stripe Connect) + platform commission, when ready.
- French translation for Wallonia/Brussels.
# matmatch
