-- fizira: очищенная миграция схемы приложения
-- источник: управляемый supabase, postgresql 17.6
-- назначение: уже инициализированный self-hosted supabase
-- файл не переносит пользователей, данные пациентов и файлы storage

\set on_error_stop on

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';
set local check_function_bodies = true;

do $$
declare
    table_name text;
    app_tables text[] := array[
        'ai_analysis_history', 'assessments', 'goals', 'parent_reports',
        'patient_contacts', 'patient_media', 'patients', 'profiles', 'sessions',
        'standardized_assessments', 'user_consents'
    ];
begin
    if to_regclass('auth.users') is null then
        raise exception 'auth.users не найдена: supabase ещё не инициализирован';
    end if;
    if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
        raise exception 'storage schema не готова: supabase storage ещё не инициализирован';
    end if;
    if to_regprocedure('auth.uid()') is null then
        raise exception 'auth.uid() не найдена';
    end if;

    foreach table_name in array app_tables loop
        if to_regclass(format('public.%I', table_name)) is not null then
            raise exception 'таблица public.% уже существует; миграция остановлена без изменений', table_name;
        end if;
    end loop;
end
$$;

-- функция профиля

create or replace function public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    set search_path to ''
    AS $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- таблицы приложения

CREATE TABLE public.ai_analysis_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    therapist_id uuid NOT NULL,
    analysis text NOT NULL,
    patient_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    analysis_type text DEFAULT 'general'::text NOT NULL
);

CREATE TABLE public.assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    therapist_id uuid DEFAULT auth.uid() NOT NULL,
    assessment_type text DEFAULT 'initial'::text NOT NULL,
    assessment_date date DEFAULT CURRENT_DATE NOT NULL,
    complaint text,
    pregnancy_history text,
    birth_history text,
    motor_development text,
    observation text,
    neuro_observations text,
    conclusion text,
    structured_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assessments_assessment_type_check CHECK ((assessment_type = ANY (ARRAY['initial'::text, 'reassessment'::text])))
);

CREATE TABLE public.goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    therapist_id uuid DEFAULT auth.uid() NOT NULL,
    title text NOT NULL,
    baseline text,
    criterion text,
    deadline date,
    progress integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT goals_progress_check CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT goals_status_check CHECK ((status = ANY (ARRAY['active'::text, 'achieved'::text, 'paused'::text, 'cancelled'::text])))
);

CREATE TABLE public.parent_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    therapist_id uuid NOT NULL,
    complaint text,
    strengths text,
    observations text,
    goals text,
    progress text,
    recommendations text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    therapist_name text,
    therapist_profession text,
    therapist_organization text,
    therapist_phone text,
    therapist_logo_path text
);

CREATE TABLE public.patient_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    therapist_id uuid NOT NULL,
    full_name text NOT NULL,
    relation text,
    phone text,
    telegram text,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.patient_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    therapist_id uuid NOT NULL,
    session_id uuid,
    assessment_id uuid,
    storage_path text NOT NULL,
    media_type text NOT NULL,
    note text,
    captured_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category text DEFAULT 'other'::text NOT NULL,
    document_type text,
    CONSTRAINT patient_media_category_check CHECK ((category = ANY (ARRAY['posture'::text, 'sitting'::text, 'crawling'::text, 'standing'::text, 'walking'::text, 'transitions'::text, 'lower_limb'::text, 'upper_limb'::text, 'equipment'::text, 'documents'::text, 'other'::text]))),
    CONSTRAINT patient_media_document_type_check CHECK (((document_type IS NULL) OR (document_type = ANY (ARRAY['mri_ct'::text, 'xray'::text, 'nsg'::text, 'eeg'::text, 'enmg'::text, 'ultrasound'::text, 'doppler'::text, 'doctor_report'::text, 'discharge'::text, 'labs'::text, 'genetic'::text, 'other'::text]))))
);

CREATE TABLE public.patients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    therapist_id uuid DEFAULT auth.uid() NOT NULL,
    display_name text NOT NULL,
    date_of_birth date,
    sex text,
    primary_complaint text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ai_analysis text,
    ai_analysis_updated_at timestamp with time zone,
    ai_dynamics_analysis text,
    ai_dynamics_updated_at timestamp with time zone,
    next_session_plan jsonb,
    CONSTRAINT patients_sex_check CHECK ((sex = ANY (ARRAY['male'::text, 'female'::text, 'unspecified'::text]))),
    CONSTRAINT patients_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'discharged'::text])))
);

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    profession text DEFAULT 'Physical therapist'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    organization text,
    phone text,
    logo_path text,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    therapist_id uuid DEFAULT auth.uid() NOT NULL,
    session_date date DEFAULT CURRENT_DATE NOT NULL,
    note text,
    tolerance text,
    structured_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    dynamics_status text,
    function_changes text,
    planned_session jsonb,
    CONSTRAINT sessions_tolerance_check CHECK (((tolerance IS NULL) OR (tolerance = ANY (ARRAY['good'::text, 'medium'::text, 'low'::text, 'unclear'::text]))))
);

CREATE TABLE public.standardized_assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    therapist_id uuid DEFAULT auth.uid() NOT NULL,
    scale text NOT NULL,
    value_text text,
    value_numeric numeric,
    assessed_at date,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT standardized_assessments_scale_check CHECK ((scale = ANY (ARRAY['gmfcs'::text, 'macs'::text, 'cfcs'::text, 'edacs'::text, 'hine'::text, 'gmfm66'::text, 'other'::text])))
);

CREATE TABLE public.user_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    terms_version text NOT NULL,
    privacy_version text NOT NULL,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL
);

-- первичные и уникальные ограничения

ALTER TABLE ONLY public.ai_analysis_history
    ADD CONSTRAINT ai_analysis_history_patient_created_unique UNIQUE (patient_id, created_at);

ALTER TABLE ONLY public.ai_analysis_history
    ADD CONSTRAINT ai_analysis_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parent_reports
    ADD CONSTRAINT parent_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.patient_contacts
    ADD CONSTRAINT patient_contacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.patient_media
    ADD CONSTRAINT patient_media_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.standardized_assessments
    ADD CONSTRAINT standardized_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.standardized_assessments
    ADD CONSTRAINT standardized_assessments_unique_patient_scale_date UNIQUE (patient_id, scale, assessed_at);

ALTER TABLE ONLY public.user_consents
    ADD CONSTRAINT user_consents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_consents
    ADD CONSTRAINT user_consents_user_id_terms_version_privacy_version_key UNIQUE (user_id, terms_version, privacy_version);

-- индексы

CREATE INDEX ai_analysis_history_patient_date_idx ON public.ai_analysis_history USING btree (patient_id, created_at DESC);

CREATE INDEX assessments_patient_idx ON public.assessments USING btree (patient_id);

CREATE INDEX goals_patient_idx ON public.goals USING btree (patient_id);

CREATE INDEX parent_reports_created_at_idx ON public.parent_reports USING btree (created_at DESC);

CREATE INDEX parent_reports_patient_id_idx ON public.parent_reports USING btree (patient_id);

CREATE UNIQUE INDEX patient_contacts_one_primary_idx ON public.patient_contacts USING btree (patient_id) WHERE (is_primary = true);

CREATE INDEX patient_contacts_patient_id_idx ON public.patient_contacts USING btree (patient_id);

CREATE INDEX patients_therapist_idx ON public.patients USING btree (therapist_id);

CREATE INDEX sessions_patient_idx ON public.sessions USING btree (patient_id);

-- внешние ключи из исходной схемы

ALTER TABLE ONLY public.ai_analysis_history
    ADD CONSTRAINT ai_analysis_history_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_therapist_id_fkey FOREIGN KEY (therapist_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_therapist_id_fkey FOREIGN KEY (therapist_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.parent_reports
    ADD CONSTRAINT parent_reports_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.patient_contacts
    ADD CONSTRAINT patient_contacts_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.patient_media
    ADD CONSTRAINT patient_media_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.patient_media
    ADD CONSTRAINT patient_media_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.patient_media
    ADD CONSTRAINT patient_media_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_therapist_id_fkey FOREIGN KEY (therapist_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_therapist_id_fkey FOREIGN KEY (therapist_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.standardized_assessments
    ADD CONSTRAINT standardized_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_consents
    ADD CONSTRAINT user_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- добавленные внешние ключи therapist_id

alter table only public.ai_analysis_history
    add constraint ai_analysis_history_therapist_id_fkey foreign key (therapist_id)
    references auth.users(id) on delete cascade;

alter table only public.parent_reports
    add constraint parent_reports_therapist_id_fkey foreign key (therapist_id)
    references auth.users(id) on delete cascade;

alter table only public.patient_contacts
    add constraint patient_contacts_therapist_id_fkey foreign key (therapist_id)
    references auth.users(id) on delete cascade;

alter table only public.patient_media
    add constraint patient_media_therapist_id_fkey foreign key (therapist_id)
    references auth.users(id) on delete cascade;

alter table only public.standardized_assessments
    add constraint standardized_assessments_therapist_id_fkey foreign key (therapist_id)
    references auth.users(id) on delete cascade;

-- включение rls

ALTER TABLE public.ai_analysis_history ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parent_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.patient_contacts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.patient_media ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.standardized_assessments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

-- политики rls таблиц приложения

CREATE POLICY "Create own AI analysis history" ON public.ai_analysis_history FOR INSERT TO authenticated WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = ai_analysis_history.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY "Delete own AI analysis history" ON public.ai_analysis_history FOR DELETE TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY "Read own AI analysis history" ON public.ai_analysis_history FOR SELECT TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY "Users can delete own patient media" ON public.patient_media FOR DELETE TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY "Users can insert own patient media" ON public.patient_media FOR INSERT TO authenticated WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = patient_media.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY "Users can update own patient media" ON public.patient_media FOR UPDATE TO authenticated USING ((therapist_id = auth.uid())) WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = patient_media.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY "Users can view own patient media" ON public.patient_media FOR SELECT TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY assessments_delete_own ON public.assessments FOR DELETE TO authenticated USING (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = assessments.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY assessments_insert_own ON public.assessments FOR INSERT TO authenticated WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = assessments.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY assessments_select_own ON public.assessments FOR SELECT TO authenticated USING (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = assessments.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY assessments_update_own ON public.assessments FOR UPDATE TO authenticated USING (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = assessments.patient_id) AND (p.therapist_id = auth.uid())))))) WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = assessments.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY goals_delete_own ON public.goals FOR DELETE TO authenticated USING (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = goals.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY goals_insert_own ON public.goals FOR INSERT TO authenticated WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = goals.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY goals_select_own ON public.goals FOR SELECT TO authenticated USING (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = goals.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY goals_update_own ON public.goals FOR UPDATE TO authenticated USING (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = goals.patient_id) AND (p.therapist_id = auth.uid())))))) WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = goals.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY parent_reports_delete_own ON public.parent_reports FOR DELETE TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY parent_reports_insert_own ON public.parent_reports FOR INSERT TO authenticated WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = parent_reports.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY parent_reports_select_own ON public.parent_reports FOR SELECT TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY parent_reports_update_own ON public.parent_reports FOR UPDATE TO authenticated USING ((therapist_id = auth.uid())) WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = parent_reports.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY patient_contacts_delete_own ON public.patient_contacts FOR DELETE TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY patient_contacts_insert_own ON public.patient_contacts FOR INSERT TO authenticated WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = patient_contacts.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY patient_contacts_select_own ON public.patient_contacts FOR SELECT TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY patient_contacts_update_own ON public.patient_contacts FOR UPDATE TO authenticated USING ((therapist_id = auth.uid())) WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = patient_contacts.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY patients_delete_own ON public.patients FOR DELETE TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY patients_insert_own ON public.patients FOR INSERT TO authenticated WITH CHECK ((therapist_id = auth.uid()));

CREATE POLICY patients_select_own ON public.patients FOR SELECT TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY patients_update_own ON public.patients FOR UPDATE TO authenticated USING ((therapist_id = auth.uid())) WITH CHECK ((therapist_id = auth.uid()));

CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK ((id = auth.uid()));

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));

CREATE POLICY sessions_delete_own ON public.sessions FOR DELETE TO authenticated USING (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = sessions.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY sessions_insert_own ON public.sessions FOR INSERT TO authenticated WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = sessions.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY sessions_select_own ON public.sessions FOR SELECT TO authenticated USING (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = sessions.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY sessions_update_own ON public.sessions FOR UPDATE TO authenticated USING (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = sessions.patient_id) AND (p.therapist_id = auth.uid())))))) WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = sessions.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY standardized_assessments_delete ON public.standardized_assessments FOR DELETE TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY standardized_assessments_insert ON public.standardized_assessments FOR INSERT TO authenticated WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = standardized_assessments.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY standardized_assessments_select ON public.standardized_assessments FOR SELECT TO authenticated USING ((therapist_id = auth.uid()));

CREATE POLICY standardized_assessments_update ON public.standardized_assessments FOR UPDATE TO authenticated USING ((therapist_id = auth.uid())) WITH CHECK (((therapist_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.patients p
  WHERE ((p.id = standardized_assessments.patient_id) AND (p.therapist_id = auth.uid()))))));

CREATE POLICY user_consents_insert_own ON public.user_consents FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

CREATE POLICY user_consents_select_own ON public.user_consents FOR SELECT TO authenticated USING ((user_id = auth.uid()));

-- профиль нового пользователя auth

drop trigger if exists fizira_handle_new_user on auth.users;
create trigger fizira_handle_new_user
    after insert on auth.users
    for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public;

-- права postgrest; rls остаётся обязательным уровнем ограничения

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all privileges on all tables in schema public to service_role;

-- бакеты создаются поверх штатной схемы self-hosted storage

insert into storage.buckets (id, name, public)
values
    ('patient-media', 'patient-media', false),
    ('specialist-logos', 'specialist-logos', false)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public;

drop policy if exists "PT Child media delete" on storage.objects;
drop policy if exists "PT Child media insert" on storage.objects;
drop policy if exists "PT Child media select" on storage.objects;
drop policy if exists "PT Child media update" on storage.objects;
drop policy if exists "specialist_logos_delete_own" on storage.objects;
drop policy if exists "specialist_logos_insert_own" on storage.objects;
drop policy if exists "specialist_logos_select_own" on storage.objects;
drop policy if exists "specialist_logos_update_own" on storage.objects;

-- пользовательские политики storage

CREATE POLICY "PT Child media delete" ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'patient-media'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))));

CREATE POLICY "PT Child media insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'patient-media'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))));

CREATE POLICY "PT Child media select" ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'patient-media'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))));

CREATE POLICY "PT Child media update" ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'patient-media'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))) WITH CHECK (((bucket_id = 'patient-media'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))));

CREATE POLICY specialist_logos_delete_own ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'specialist-logos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY specialist_logos_insert_own ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'specialist-logos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY specialist_logos_select_own ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'specialist-logos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY specialist_logos_update_own ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'specialist-logos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))) WITH CHECK (((bucket_id = 'specialist-logos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

commit;
