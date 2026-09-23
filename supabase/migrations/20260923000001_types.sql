-- 1. Custom types (enums)

create type public.user_role as enum ('admin', 'teacher', 'student', 'parent');

create type public.admin_level as enum ('super_admin', 'limited_admin');

create type public.enrollment_status as enum ('active', 'promoted', 'repeated', 'graduated', 'withdrawn');

create type public.attendance_status as enum ('present', 'absent', 'late', 'excused');

create type public.invoice_status as enum ('unpaid', 'partial', 'paid', 'overdue');

create type public.payment_provider as enum ('paystack', 'flutterwave', 'manual');

create type public.payment_status as enum ('pending', 'successful', 'failed');

create type public.announcement_audience as enum ('all', 'teachers', 'students', 'parents', 'specific_class');

create type public.day_of_week as enum ('monday', 'tuesday', 'wednesday', 'thursday', 'friday');
