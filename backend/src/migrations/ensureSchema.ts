import { query } from '../db';

export async function ensureSchema(): Promise<void> {
  await query(`
    create table if not exists condos (
      id serial primary key,
      name varchar(150) not null,
      created_at timestamptz not null default now()
    );

    alter table condos add column if not exists login_logo_path varchar(500);
    alter table condos add column if not exists login_background_path varchar(500);

    create table if not exists units (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      tower varchar(20) not null,
      number varchar(20) not null,
      resident_name varchar(150) not null,
      created_at timestamptz not null default now()
    );

    create table if not exists app_modules (
      id serial primary key,
      code varchar(60) not null unique,
      name varchar(120) not null,
      icon_key varchar(60) not null,
      display_order integer not null,
      enabled boolean not null default true
    );

    create table if not exists notices (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      title varchar(150) not null,
      content text not null,
      published_at timestamptz not null default now()
    );

    alter table notices add column if not exists is_pinned boolean not null default false;
    alter table notices add column if not exists is_archived boolean not null default false;
    alter table notices add column if not exists urgency varchar(20) not null default 'normal';
    alter table notices add column if not exists audience varchar(120);
    alter table notices add column if not exists expires_at timestamptz;
    alter table notices add column if not exists notice_sort_at timestamptz;
    update notices set notice_sort_at = published_at where notice_sort_at is null;
    alter table notices alter column notice_sort_at set default now();

    create table if not exists notice_attachments (
      id serial primary key,
      notice_id integer not null references notices(id) on delete cascade,
      sort_order integer not null default 0,
      file_name varchar(255) not null,
      mime_type varchar(120) not null,
      byte_size integer not null,
      storage_path varchar(500) not null,
      created_at timestamptz not null default now()
    );

    create index if not exists notice_attachments_notice_id_idx
      on notice_attachments (notice_id);

    create table if not exists maintenance_requests (
      id serial primary key,
      unit_id integer not null references units(id) on delete cascade,
      title varchar(150) not null,
      description text not null,
      priority varchar(20) not null default 'normal',
      status varchar(20) not null default 'open',
      syndic_response text,
      updated_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );

    alter table maintenance_requests add column if not exists syndic_response text;
    alter table maintenance_requests add column if not exists updated_at timestamptz not null default now();

    create table if not exists app_users (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      unit_id integer references units(id) on delete set null,
      full_name varchar(150) not null,
      login varchar(80) not null unique,
      password_plain varchar(120) not null,
      role varchar(30) not null
        check (role in ('syndic', 'administrator', 'resident', 'partner', 'collaborator', 'doorman')),
      active boolean not null default true,
      created_at timestamptz not null default now()
    );

    create table if not exists maintenance_request_messages (
      id serial primary key,
      maintenance_request_id integer not null references maintenance_requests(id) on delete cascade,
      user_id integer not null references app_users(id) on delete restrict,
      author_role varchar(20) not null
        check (author_role in ('resident', 'staff')),
      body text not null,
      created_at timestamptz not null default now()
    );

    create index if not exists maintenance_request_messages_req_idx
      on maintenance_request_messages (maintenance_request_id);

    create table if not exists occurrences (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      unit_id integer references units(id) on delete set null,
      title varchar(150) not null,
      description text not null,
      category varchar(60),
      status varchar(20) not null default 'open'
        check (status in ('open', 'in_progress', 'closed')),
      reporter_name varchar(150),
      syndic_response text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      resolved_at timestamptz
    );

    alter table occurrences add column if not exists reporter_name varchar(150);
    alter table occurrences add column if not exists syndic_response text;

    create table if not exists space_reservations (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      unit_id integer not null references units(id) on delete cascade,
      space_name varchar(120) not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      status varchar(20) not null default 'pending'
        check (status in ('pending', 'approved', 'rejected', 'cancelled')),
      notes text,
      created_at timestamptz not null default now()
    );

    alter table space_reservations
      add column if not exists requester_name varchar(150);

    create table if not exists reservation_spaces (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      name varchar(120) not null,
      description text not null,
      icon_key varchar(60) not null default 'meeting_room',
      capacity integer,
      requires_approval boolean not null default true,
      active boolean not null default true,
      created_at timestamptz not null default now()
    );

    create unique index if not exists units_condo_tower_number_uq
      on units (condo_id, tower, number);

    create table if not exists unit_residents (
      id serial primary key,
      unit_id integer not null references units(id) on delete cascade,
      role varchar(30) not null
        check (role in ('owner', 'tenant', 'resident', 'other')),
      full_name varchar(150) not null,
      phone varchar(40),
      email varchar(150),
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists unit_residents_unit_id_idx
      on unit_residents (unit_id);

    create table if not exists unit_vehicles (
      id serial primary key,
      unit_id integer not null references units(id) on delete cascade,
      model varchar(120) not null,
      plate varchar(20) not null,
      parking_spot varchar(40),
      color varchar(40),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists unit_vehicles_unit_id_idx
      on unit_vehicles (unit_id);

    create unique index if not exists unit_vehicles_unit_plate_uq
      on unit_vehicles (unit_id, lower(plate));

    create table if not exists unit_pets (
      id serial primary key,
      unit_id integer not null references units(id) on delete cascade,
      name varchar(120) not null,
      species varchar(60) not null,
      breed varchar(80),
      color varchar(40),
      photo_url text,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists unit_pets_unit_id_idx
      on unit_pets (unit_id);

    create unique index if not exists reservation_spaces_condo_name_idx
      on reservation_spaces (condo_id, lower(name));

    alter table reservation_spaces
      add column if not exists photo_urls jsonb not null default '[]'::jsonb;

    create table if not exists registration_requests (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      unit_id integer references units(id) on delete set null,
      request_type varchar(30) not null
        check (request_type in ('resident', 'visitor', 'other')),
      full_name varchar(150) not null,
      details text,
      status varchar(20) not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),
      created_at timestamptz not null default now()
    );

    create table if not exists mass_communications (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      subject varchar(150) not null,
      message text not null,
      audience varchar(120) not null,
      created_at timestamptz not null default now()
    );

    create table if not exists financial_entries (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      entry_month date not null,
      type varchar(20) not null check (type in ('revenue', 'expense')),
      category varchar(80) not null,
      amount numeric(14, 2) not null,
      description text,
      created_at timestamptz not null default now()
    );

    create table if not exists events (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      title varchar(200) not null,
      description text,
      event_date timestamptz not null,
      location varchar(200)
    );

    alter table events add column if not exists event_end timestamptz;
    alter table events add column if not exists visibility varchar(20) not null default 'public';
    alter table events add column if not exists created_by_user_id integer references app_users(id) on delete set null;
    alter table events add column if not exists created_at timestamptz not null default now();
    alter table events add column if not exists updated_at timestamptz not null default now();

    create index if not exists events_condo_event_date_idx
      on events (condo_id, event_date asc);

    create table if not exists relation_threads (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      unit_id integer not null references units(id) on delete cascade,
      channel varchar(30) not null
        check (channel in ('syndic', 'administration', 'doorman', 'collaborator')),
      last_message_at timestamptz,
      created_at timestamptz not null default now(),
      unique (condo_id, unit_id, channel)
    );

    create index if not exists relation_threads_condo_channel_idx
      on relation_threads (condo_id, channel, last_message_at desc nulls last);

    create table if not exists relation_messages (
      id serial primary key,
      thread_id integer not null references relation_threads(id) on delete cascade,
      sender_side varchar(20) not null
        check (sender_side in ('resident', 'staff')),
      body text not null,
      created_at timestamptz not null default now()
    );

    create index if not exists relation_messages_thread_id_idx
      on relation_messages (thread_id, created_at asc);

    -- Threads de relacionamento iniciadas por parceiros (sem unidade no condomínio).
    alter table relation_threads alter column unit_id drop not null;
    alter table relation_threads add column if not exists partner_user_id integer references app_users(id) on delete cascade;
    alter table relation_threads drop constraint if exists relation_threads_condo_id_unit_id_channel_key;
    create unique index if not exists relation_threads_condo_unit_channel_uq
      on relation_threads (condo_id, unit_id, channel) where unit_id is not null;
    create unique index if not exists relation_threads_condo_partner_channel_uq
      on relation_threads (condo_id, partner_user_id, channel) where partner_user_id is not null;
    alter table relation_threads drop constraint if exists relation_threads_participant_chk;
    alter table relation_threads add constraint relation_threads_participant_chk
      check (
        (unit_id is not null and partner_user_id is null)
        or (unit_id is null and partner_user_id is not null)
      );

    alter table relation_messages drop constraint if exists relation_messages_sender_side_check;
    alter table relation_messages add constraint relation_messages_sender_side_check
      check (sender_side in ('resident', 'staff', 'partner'));

    create table if not exists individual_communications (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      to_unit_id integer not null references units(id) on delete cascade,
      from_unit_id integer references units(id) on delete set null,
      from_staff_role varchar(30)
        check (from_staff_role is null or from_staff_role in ('syndic', 'administrator', 'collaborator', 'doorman')),
      subject varchar(150) not null,
      body text not null,
      read_at timestamptz,
      created_at timestamptz not null default now(),
      check (
        (from_unit_id is not null and from_staff_role is null)
        or
        (from_unit_id is null and from_staff_role is not null)
      )
    );

    create index if not exists individual_comm_to_unit_idx
      on individual_communications (condo_id, to_unit_id, created_at desc);

    create index if not exists individual_comm_from_unit_idx
      on individual_communications (condo_id, from_unit_id, created_at desc)
      where from_unit_id is not null;

    create index if not exists individual_comm_from_staff_idx
      on individual_communications (condo_id, from_staff_role, created_at desc)
      where from_staff_role is not null;

    create table if not exists condo_documents (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      title varchar(200) not null,
      description text,
      file_name varchar(255) not null,
      mime_type varchar(120) not null,
      byte_size integer not null,
      storage_path varchar(500) not null,
      created_at timestamptz not null default now()
    );

    create index if not exists condo_documents_condo_id_idx
      on condo_documents (condo_id, created_at desc);

    alter table condo_documents add column if not exists document_type varchar(80);
    update condo_documents set document_type = 'Outros' where document_type is null;
    alter table condo_documents alter column document_type set default 'Outros';
    alter table condo_documents alter column document_type set not null;

    alter table condo_documents add column if not exists visible_to_all boolean;
    update condo_documents set visible_to_all = true where visible_to_all is null;
    alter table condo_documents alter column visible_to_all set default true;
    alter table condo_documents alter column visible_to_all set not null;

    alter table condo_documents add column if not exists viewer_roles jsonb;
    update condo_documents
    set viewer_roles = '[]'::jsonb
    where viewer_roles is null;
    alter table condo_documents alter column viewer_roles set default '[]'::jsonb;
    alter table condo_documents alter column viewer_roles set not null;

    alter table condo_documents
      add column if not exists posted_by_user_id integer references app_users (id) on delete set null;
    create index if not exists condo_documents_posted_by_user_id_idx
      on condo_documents (posted_by_user_id);

    create table if not exists condo_contacts (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      category varchar(30) not null
        check (category in ('syndic', 'administration', 'intercom', 'other')),
      name varchar(150) not null,
      phone varchar(50),
      extension varchar(30),
      email varchar(150),
      notes text,
      sort_order integer not null default 0,
      visible_to varchar(40) not null default 'everyone',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_contacts_condo_cat_idx
      on condo_contacts (condo_id, category, sort_order, name);

    create table if not exists condo_offers (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      scope varchar(20) not null
        check (scope in ('condo', 'resident', 'partner')),
      title varchar(200) not null,
      description text,
      created_by_user_id integer not null references app_users(id) on delete restrict,
      unit_id integer references units(id) on delete set null,
      partner_label varchar(200),
      category varchar(80) not null default 'Outros',
      redemption_kind varchar(30) not null default 'coupon_code',
      coupon_text text,
      program_instructions text,
      contact_phone varchar(50),
      contact_whatsapp varchar(50),
      contact_email varchar(150),
      contact_url text,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (
        (scope = 'condo' and unit_id is null)
        or (scope = 'resident' and unit_id is not null)
        or (scope = 'partner' and unit_id is null)
      )
    );

    create index if not exists condo_offers_condo_scope_idx
      on condo_offers (condo_id, scope, active, created_at desc);

    alter table condo_offers add column if not exists category varchar(80) not null default 'Outros';
    alter table condo_offers add column if not exists redemption_kind varchar(30) not null default 'coupon_code';
    alter table condo_offers add column if not exists coupon_text text;
    alter table condo_offers add column if not exists program_instructions text;
    alter table condo_offers add column if not exists contact_phone varchar(50);
    alter table condo_offers add column if not exists contact_whatsapp varchar(50);
    alter table condo_offers add column if not exists contact_email varchar(150);
    alter table condo_offers add column if not exists contact_url text;

    create index if not exists condo_offers_condo_category_idx
      on condo_offers (condo_id, category, active, created_at desc);

    create table if not exists condo_offer_enrollments (
      id serial primary key,
      offer_id integer not null references condo_offers(id) on delete cascade,
      user_id integer not null references app_users(id) on delete cascade,
      enrolled_at timestamptz not null default now(),
      unique (offer_id, user_id)
    );

    create index if not exists condo_offer_enrollments_offer_idx
      on condo_offer_enrollments (offer_id);

    create table if not exists condo_emergency_incidents (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      unit_id integer references units(id) on delete set null,
      reporter_user_id integer not null references app_users(id) on delete restrict,
      incident_kind varchar(40) not null,
      description text,
      action_taken text,
      status varchar(20) not null default 'open',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_emergency_incidents_condo_idx
      on condo_emergency_incidents (condo_id, created_at desc);

    alter table condo_emergency_incidents add column if not exists action_taken text;

    create table if not exists condo_parcel_deliveries (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      unit_id integer not null references units(id) on delete cascade,
      registered_by_user_id integer not null references app_users(id) on delete restrict,
      carrier_hint varchar(120),
      recipient_label varchar(200),
      notes text,
      status varchar(24) not null default 'awaiting_pickup',
      picked_up_at timestamptz,
      picked_up_by_user_id integer references app_users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_parcel_deliveries_unit_idx
      on condo_parcel_deliveries (condo_id, unit_id, status, created_at desc);

    create table if not exists condo_polls (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      kind varchar(30) not null
        check (kind in ('survey', 'formal_ballot')),
      title varchar(250) not null,
      description text,
      status varchar(20) not null default 'draft'
        check (status in ('draft', 'open', 'closed')),
      created_by_user_id integer not null references app_users(id) on delete restrict,
      opens_at timestamptz,
      closes_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_polls_condo_status_idx
      on condo_polls (condo_id, status, kind, created_at desc);

    create table if not exists condo_poll_options (
      id serial primary key,
      poll_id integer not null references condo_polls(id) on delete cascade,
      label varchar(500) not null,
      sort_order integer not null default 0,
      created_at timestamptz not null default now()
    );

    create index if not exists condo_poll_options_poll_idx
      on condo_poll_options (poll_id, sort_order, id);

    create table if not exists condo_poll_votes (
      id serial primary key,
      poll_id integer not null references condo_polls(id) on delete cascade,
      user_id integer not null references app_users(id) on delete cascade,
      option_id integer not null references condo_poll_options(id) on delete restrict,
      voted_at timestamptz not null default now(),
      unique (poll_id, user_id)
    );

    create index if not exists condo_poll_votes_poll_idx on condo_poll_votes (poll_id);

    create index if not exists condo_poll_votes_user_idx on condo_poll_votes (user_id);

    create table if not exists condo_lost_found (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      unit_id integer references units(id) on delete set null,
      kind varchar(20) not null
        check (kind in ('lost', 'found')),
      title varchar(200) not null,
      description text,
      contact_hint varchar(200),
      photo_url text,
      status varchar(20) not null default 'open'
        check (status in ('open', 'resolved')),
      created_by_user_id integer not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_lost_found_condo_idx
      on condo_lost_found (condo_id, kind, status, created_at desc);

    create table if not exists condo_lost_found_achei (
      id serial primary key,
      lost_found_id integer not null references condo_lost_found(id) on delete cascade,
      user_id integer not null references app_users(id) on delete cascade,
      message varchar(600) not null,
      created_at timestamptz not null default now()
    );

    create index if not exists condo_lost_found_achei_lf_idx
      on condo_lost_found_achei (lost_found_id, created_at);

    create table if not exists condo_complaints_book (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      unit_id integer references units(id) on delete set null,
      created_by_user_id integer not null references app_users(id) on delete restrict,
      entry_type varchar(20) not null
        check (entry_type in ('occurrence', 'complaint', 'improvement')),
      subject varchar(200) not null,
      description text not null,
      status varchar(20) not null default 'open'
        check (status in ('open', 'in_progress', 'closed')),
      admin_response text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_complaints_book_condo_idx
      on condo_complaints_book (condo_id, entry_type, status, created_at desc);

    alter table condo_lost_found add column if not exists unit_id integer references units(id) on delete set null;
    alter table condo_lost_found add column if not exists photo_url text;
    alter table condo_lost_found add column if not exists photo_urls jsonb not null default '[]'::jsonb;
    update condo_lost_found
      set photo_urls = jsonb_build_array(photo_url)
      where photo_url is not null
        and trim(photo_url) <> ''
        and (photo_urls is null or jsonb_array_length(photo_urls) = 0);

    create table if not exists condo_market_listings (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      title varchar(200) not null,
      description text,
      category varchar(80),
      price_amount numeric(14, 2),
      price_note varchar(150),
      contact_hint varchar(200),
      status varchar(20) not null default 'active'
        check (status in ('active', 'closed')),
      created_by_user_id integer not null references app_users(id) on delete restrict,
      expires_at timestamptz not null default (now() + interval '30 days'),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_market_listings_condo_idx
      on condo_market_listings (condo_id, status, created_at desc);

    alter table condo_market_listings add column if not exists listing_scope varchar(20);
    update condo_market_listings set listing_scope = 'residents' where listing_scope is null;
    alter table condo_market_listings alter column listing_scope set default 'residents';
    alter table condo_market_listings alter column listing_scope set not null;
    alter table condo_market_listings drop constraint if exists condo_market_listings_listing_scope_check;
    alter table condo_market_listings add constraint condo_market_listings_listing_scope_check
      check (listing_scope in ('condominium', 'residents'));

    alter table condo_market_listings add column if not exists contact_phone varchar(80);
    alter table condo_market_listings add column if not exists contact_email varchar(150);
    alter table condo_market_listings add column if not exists contact_whatsapp varchar(80);
    alter table condo_market_listings add column if not exists expires_at timestamptz;
    update condo_market_listings
    set expires_at = created_at + interval '30 days'
    where expires_at is null;
    alter table condo_market_listings alter column expires_at set default (now() + interval '30 days');
    alter table condo_market_listings alter column expires_at set not null;

    create table if not exists condo_market_listing_photos (
      id serial primary key,
      listing_id integer not null references condo_market_listings(id) on delete cascade,
      photo_url text not null,
      sort_order integer not null default 0,
      created_at timestamptz not null default now()
    );

    create index if not exists condo_market_listing_photos_listing_idx
      on condo_market_listing_photos (listing_id, sort_order, id);

    create table if not exists condo_market_listing_interests (
      id serial primary key,
      listing_id integer not null references condo_market_listings(id) on delete cascade,
      user_id integer not null references app_users(id) on delete cascade,
      created_at timestamptz not null default now(),
      unique (listing_id, user_id)
    );

    create index if not exists condo_market_listing_interests_listing_idx
      on condo_market_listing_interests (listing_id, created_at desc);
    create index if not exists condo_market_listing_interests_user_idx
      on condo_market_listing_interests (user_id, created_at desc);

    create table if not exists condo_collaborators (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      full_name varchar(150) not null,
      job_title varchar(120) not null,
      phone varchar(50),
      email varchar(150),
      photo_url text,
      notes text,
      sort_order integer not null default 0,
      active boolean not null default true,
      created_by_user_id integer not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_collaborators_condo_idx
      on condo_collaborators (condo_id, active, sort_order, full_name);

    create table if not exists condo_collaborator_shifts (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      collaborator_id integer not null references condo_collaborators(id) on delete cascade,
      shift_date date not null,
      time_start varchar(32),
      time_end varchar(32),
      notes text,
      sort_order integer not null default 0,
      created_by_user_id integer not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    alter table condo_collaborator_shifts add column if not exists shift_date date;

    alter table condo_collaborator_shifts add column if not exists time_start varchar(32);
    alter table condo_collaborator_shifts add column if not exists time_end varchar(32);

    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'condo_collaborator_shifts'
          and column_name = 'time_range'
      ) then
        execute $migrate$
          update condo_collaborator_shifts
          set time_start = coalesce(nullif(trim(time_start), ''), time_range)
          where time_range is not null and nullif(trim(time_range), '') is not null
            and (time_start is null or trim(time_start) = '')
        $migrate$;
        alter table condo_collaborator_shifts drop column time_range;
      end if;
    end $$;

    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'condo_collaborator_shifts'
          and column_name = 'weekday'
      ) then
        alter table condo_collaborator_shifts drop constraint if exists condo_collaborator_shifts_weekday_check;
        alter table condo_collaborator_shifts rename column weekday to day_of_month;
      end if;
    end $$;

    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'condo_collaborator_shifts'
          and column_name = 'day_of_month'
      ) then
        alter table condo_collaborator_shifts drop constraint if exists condo_collaborator_shifts_day_of_month_check;
        execute $fill$
          update condo_collaborator_shifts
          set shift_date = make_date(
            extract(year from current_date)::int,
            extract(month from current_date)::int,
            least(
              day_of_month,
              extract(day from (
                date_trunc('month', current_date)
                + interval '1 month'
                - interval '1 day'
              ))::int
            )
          )
          where shift_date is null
        $fill$;
        alter table condo_collaborator_shifts drop column day_of_month;
      end if;
    end $$;

    alter table condo_collaborator_shifts alter column shift_date set not null;

    drop index if exists condo_collaborator_shifts_condo_idx;
    create index if not exists condo_collaborator_shifts_condo_idx
      on condo_collaborator_shifts (condo_id, shift_date, sort_order);

    create table if not exists shift_handover_areas (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      name varchar(150) not null,
      service_name varchar(150) not null,
      instructions text,
      active boolean not null default true,
      created_by_user_id integer not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists shift_handover_areas_condo_idx
      on shift_handover_areas (condo_id, active, name);

    create table if not exists shift_handover_area_members (
      area_id integer not null references shift_handover_areas(id) on delete cascade,
      user_id integer not null references app_users(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (area_id, user_id)
    );

    create index if not exists shift_handover_area_members_user_idx
      on shift_handover_area_members (user_id, area_id);

    create table if not exists shift_handover_entries (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      area_id integer not null references shift_handover_areas(id) on delete cascade,
      author_user_id integer not null references app_users(id) on delete restrict,
      body text not null,
      created_at timestamptz not null default now()
    );

    create index if not exists shift_handover_entries_area_idx
      on shift_handover_entries (area_id, created_at desc);

    create table if not exists condo_service_catalog (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      title varchar(200) not null,
      description text,
      category varchar(80),
      provider_name varchar(150),
      provider_phone varchar(50),
      provider_email varchar(150),
      sort_order integer not null default 0,
      active boolean not null default true,
      created_by_user_id integer not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_service_catalog_condo_idx
      on condo_service_catalog (condo_id, active, sort_order, title);

    alter table condo_service_catalog add column if not exists scope varchar(20);
    update condo_service_catalog set scope = 'unit' where scope is null;
    alter table condo_service_catalog alter column scope set default 'unit';
    alter table condo_service_catalog alter column scope set not null;
    alter table condo_service_catalog drop constraint if exists condo_service_catalog_scope_check;
    alter table condo_service_catalog add constraint condo_service_catalog_scope_check
      check (scope in ('unit', 'condo'));

    alter table condo_service_catalog add column if not exists visible boolean;
    update condo_service_catalog set visible = true where visible is null;
    alter table condo_service_catalog alter column visible set default true;
    alter table condo_service_catalog alter column visible set not null;

    alter table condo_service_catalog add column if not exists provider_whatsapp varchar(50);

    create table if not exists condo_service_catalog_photos (
      id serial primary key,
      service_id integer not null references condo_service_catalog(id) on delete cascade,
      photo_url text not null,
      sort_order integer not null default 0,
      created_at timestamptz not null default now()
    );

    create index if not exists condo_service_catalog_photos_svc_idx
      on condo_service_catalog_photos (service_id, sort_order, id);

    create table if not exists condo_service_requests (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      service_id integer not null references condo_service_catalog(id) on delete restrict,
      unit_id integer not null references units(id) on delete cascade,
      created_by_user_id integer not null references app_users(id) on delete restrict,
      message text not null,
      preferred_date date,
      status varchar(20) not null default 'pending'
        check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
      staff_notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_service_requests_condo_idx
      on condo_service_requests (condo_id, status, created_at desc);

    create index if not exists condo_service_requests_by_user_idx
      on condo_service_requests (condo_id, created_by_user_id, created_at desc);

    create table if not exists condo_video_rooms (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      title varchar(200) not null,
      description text,
      room_slug varchar(200) not null,
      status varchar(20) not null default 'scheduled'
        check (status in ('scheduled', 'live', 'ended')),
      scheduled_starts_at timestamptz,
      scheduled_ends_at timestamptz,
      jitsi_base_url text,
      created_by_user_id integer not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (room_slug)
    );

    create index if not exists condo_video_rooms_condo_idx
      on condo_video_rooms (condo_id, status, created_at desc);

    create table if not exists condo_virtual_assemblies (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      title varchar(250) not null,
      description text,
      status varchar(20) not null default 'draft'
        check (status in ('draft', 'scheduled', 'live', 'completed', 'cancelled')),
      scheduled_starts_at timestamptz,
      scheduled_ends_at timestamptz,
      video_room_id integer references condo_video_rooms(id) on delete set null,
      created_by_user_id integer not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_virtual_assemblies_condo_idx
      on condo_virtual_assemblies (condo_id, status, scheduled_starts_at desc nulls last);

    create table if not exists condo_assembly_attendance (
      id serial primary key,
      assembly_id integer not null references condo_virtual_assemblies(id) on delete cascade,
      user_id integer not null references app_users(id) on delete cascade,
      marked_at timestamptz not null default now(),
      unique (assembly_id, user_id)
    );

    create index if not exists condo_assembly_attendance_assembly_idx
      on condo_assembly_attendance (assembly_id);

    alter table units add column if not exists monthly_fee numeric(12,2) not null default 0;
    alter table units add column if not exists reserve_fund_fee numeric(12,2) not null default 0;
    alter table units add column if not exists billing_active boolean not null default true;

    create table if not exists condo_billing_campaigns (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      title varchar(200) not null,
      competence varchar(20) not null,
      due_date date not null,
      fine_percent numeric(6,2),
      interest_percent_month numeric(6,2),
      discount_amount numeric(12,2),
      notes text,
      status varchar(20) not null default 'draft',
      created_by_user_id integer not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (condo_id, competence)
    );

    create index if not exists condo_billing_campaigns_condo_idx
      on condo_billing_campaigns (condo_id, status, due_date desc);

    create table if not exists condo_unit_charges (
      id serial primary key,
      campaign_id integer not null references condo_billing_campaigns(id) on delete cascade,
      unit_id integer not null references units(id) on delete cascade,
      amount numeric(12,2) not null,
      condominium_part numeric(12,2),
      reserve_part numeric(12,2),
      status varchar(20) not null default 'pending',
      boleto_url text,
      barcode text,
      pix_copia_cola text,
      gateway_charge_id varchar(120),
      paid_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (campaign_id, unit_id)
    );

    create index if not exists condo_unit_charges_unit_idx
      on condo_unit_charges (unit_id, status);
    create index if not exists condo_unit_charges_campaign_idx
      on condo_unit_charges (campaign_id);

    create table if not exists condo_access_visitor_passes (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      unit_id integer not null references units(id) on delete cascade,
      visitor_full_name varchar(150) not null,
      visitor_phone varchar(40),
      document_id varchar(40),
      valid_from timestamptz not null,
      valid_until timestamptz not null,
      status varchar(20) not null default 'pending',
      pin_code varchar(8) not null,
      qr_token uuid not null,
      notes text,
      created_by_user_id integer not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (qr_token)
    );

    create index if not exists condo_access_visitor_passes_condo_idx
      on condo_access_visitor_passes (condo_id, status, valid_until desc);
    create index if not exists condo_access_visitor_passes_unit_idx
      on condo_access_visitor_passes (unit_id);

    create table if not exists condo_access_service_providers (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      company_name varchar(200) not null,
      notes text,
      access_window_start time,
      access_window_end time,
      active boolean not null default true,
      created_by_user_id integer not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_access_service_providers_condo_idx
      on condo_access_service_providers (condo_id, active);

    create table if not exists condo_access_events (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      unit_id integer references units(id) on delete set null,
      visitor_pass_id integer references condo_access_visitor_passes(id) on delete set null,
      service_provider_id integer references condo_access_service_providers(id) on delete set null,
      direction varchar(10) not null,
      method varchar(20) not null default 'manual',
      subject_name varchar(200) not null,
      recorded_at timestamptz not null default now(),
      recorded_by_user_id integer references app_users(id) on delete set null,
      notes text
    );

    create index if not exists condo_access_events_condo_idx
      on condo_access_events (condo_id, recorded_at desc);
    create index if not exists condo_access_events_unit_idx
      on condo_access_events (unit_id);

    create table if not exists condo_admin_contracts (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      title varchar(200) not null,
      counterparty_name varchar(200) not null,
      category varchar(60) not null default 'supplier',
      starts_at date,
      ends_at date,
      value_amount numeric(14,2),
      notes text,
      attachment_url text,
      status varchar(20) not null default 'active'
        check (status in ('active', 'expiring', 'archived')),
      created_by_user_id integer references app_users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_admin_contracts_condo_idx
      on condo_admin_contracts (condo_id, status, ends_at desc nulls last);

    create table if not exists condo_admin_registry_documents (
      id serial primary key,
      condo_id integer not null references condos(id) on delete cascade,
      title varchar(200) not null,
      category varchar(60) not null default 'other',
      document_date date,
      notes text,
      attachment_url text,
      created_by_user_id integer references app_users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists condo_admin_registry_documents_condo_idx
      on condo_admin_registry_documents (condo_id, document_date desc nulls last);
  `);

  await query(`
    alter table app_users drop constraint if exists app_users_role_check;
    alter table app_users add constraint app_users_role_check
      check (role in ('admin', 'syndic', 'administrator', 'resident', 'partner', 'collaborator', 'doorman'));

    alter table relation_threads drop constraint if exists relation_threads_channel_check;
    alter table relation_threads add constraint relation_threads_channel_check
      check (channel in ('syndic', 'administration', 'doorman', 'collaborator'));

    alter table individual_communications
      drop constraint if exists individual_communications_from_staff_role_check;
    alter table individual_communications
      add constraint individual_communications_from_staff_role_check
      check (
        from_staff_role is null
        or from_staff_role in ('syndic', 'administrator', 'collaborator', 'doorman')
      );

    alter table condo_contacts add column if not exists visible_to varchar(40);
    update condo_contacts set visible_to = 'everyone' where visible_to is null;
    alter table condo_contacts alter column visible_to set default 'everyone';
    alter table condo_contacts alter column visible_to set not null;
    alter table condo_contacts drop constraint if exists condo_contacts_visible_to_check;
    alter table condo_contacts add constraint condo_contacts_visible_to_check
      check (visible_to in ('everyone', 'syndic_only', 'syndic_administration', 'operational_staff'));

    alter table condo_polls drop constraint if exists condo_polls_kind_check;
    alter table condo_polls add constraint condo_polls_kind_check
      check (kind in ('survey', 'formal_ballot'));

    alter table condo_polls drop constraint if exists condo_polls_status_check;
    alter table condo_polls add constraint condo_polls_status_check
      check (status in ('draft', 'open', 'closed'));

    alter table condo_polls add column if not exists eligible_roles text[] not null default array['resident']::text[];

    alter table events drop constraint if exists events_visibility_check;
    alter table events add constraint events_visibility_check
      check (visibility in ('public', 'private'));

    alter table condo_lost_found drop constraint if exists condo_lost_found_kind_check;
    alter table condo_lost_found add constraint condo_lost_found_kind_check
      check (kind in ('lost', 'found'));

    alter table condo_lost_found drop constraint if exists condo_lost_found_status_check;
    alter table condo_lost_found add constraint condo_lost_found_status_check
      check (status in ('open', 'resolved'));

    alter table condo_complaints_book drop constraint if exists condo_complaints_book_entry_type_check;
    alter table condo_complaints_book add constraint condo_complaints_book_entry_type_check
      check (entry_type in ('occurrence', 'complaint', 'improvement'));

    alter table condo_complaints_book drop constraint if exists condo_complaints_book_status_check;
    alter table condo_complaints_book add constraint condo_complaints_book_status_check
      check (status in ('open', 'in_progress', 'closed'));

    alter table condo_market_listings drop constraint if exists condo_market_listings_status_check;
    alter table condo_market_listings add constraint condo_market_listings_status_check
      check (status in ('active', 'closed'));

    alter table condo_service_requests drop constraint if exists condo_service_requests_status_check;
    alter table condo_service_requests add constraint condo_service_requests_status_check
      check (status in ('pending', 'in_progress', 'completed', 'cancelled'));

    alter table condo_video_rooms drop constraint if exists condo_video_rooms_status_check;
    alter table condo_video_rooms add constraint condo_video_rooms_status_check
      check (status in ('scheduled', 'live', 'ended'));

    alter table condo_virtual_assemblies drop constraint if exists condo_virtual_assemblies_status_check;
    alter table condo_virtual_assemblies add constraint condo_virtual_assemblies_status_check
      check (status in ('draft', 'scheduled', 'live', 'completed', 'cancelled'));

    alter table condo_billing_campaigns drop constraint if exists condo_billing_campaigns_status_check;
    alter table condo_billing_campaigns add constraint condo_billing_campaigns_status_check
      check (status in ('draft', 'generated', 'closed'));

    alter table condo_unit_charges drop constraint if exists condo_unit_charges_status_check;
    alter table condo_unit_charges add constraint condo_unit_charges_status_check
      check (status in ('pending', 'paid', 'overdue', 'cancelled'));

    update condo_billing_campaigns bc
    set status = 'draft', updated_at = now()
    where bc.status = 'generated'
      and not exists (
        select 1 from condo_unit_charges uc where uc.campaign_id = bc.id
      );

    alter table condo_access_visitor_passes drop constraint if exists condo_access_visitor_passes_status_check;
    alter table condo_access_visitor_passes add constraint condo_access_visitor_passes_status_check
      check (status in ('pending', 'inside', 'completed', 'revoked', 'expired'));

    alter table condo_access_events drop constraint if exists condo_access_events_direction_check;
    alter table condo_access_events add constraint condo_access_events_direction_check
      check (direction in ('in', 'out'));

    alter table condo_access_events drop constraint if exists condo_access_events_method_check;
    alter table condo_access_events add constraint condo_access_events_method_check
      check (method in ('qr', 'pin', 'manual', 'rfid'));

    insert into condos (name)
    select 'Residencial Jardim Central'
    where not exists (
      select 1 from condos where name = 'Residencial Jardim Central'
    );

    insert into units (condo_id, tower, number, resident_name)
    select c.id, 'A', '101', 'Carlos Almeida'
    from condos c
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from units u
        where u.condo_id = c.id and u.tower = 'A' and u.number = '101'
      );

    insert into units (condo_id, tower, number, resident_name)
    select c.id, 'B', '202', 'Mariana Costa'
    from condos c
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from units u
        where u.condo_id = c.id and u.tower = 'B' and u.number = '202'
      );

    insert into occurrences (
      condo_id,
      unit_id,
      title,
      description,
      category,
      status,
      reporter_name
    )
    select
      c.id,
      u.id,
      'Ruido excessivo',
      'Relato de barulho apos 22h no corredor da torre A.',
      'Convivencia',
      'open',
      'Morador da unidade A-101'
    from condos c
    join units u on u.condo_id = c.id and u.tower = 'A' and u.number = '101'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from occurrences o
        where o.condo_id = c.id and o.title = 'Ruido excessivo'
      );

    insert into occurrences (
      condo_id,
      unit_id,
      title,
      description,
      category,
      status,
      reporter_name
    )
    select
      c.id,
      u.id,
      'Vazamento na garagem B1',
      'Agua escorrendo proxima a coluna 12 desde ontem.',
      'Infraestrutura',
      'open',
      'Equipe da portaria'
    from condos c
    join units u on u.condo_id = c.id and u.tower = 'B' and u.number = '202'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from occurrences o
        where o.condo_id = c.id and o.title = 'Vazamento na garagem B1'
      );

    insert into maintenance_requests (unit_id, title, description, priority, status)
    select u.id, 'Infiltracao banheiro', 'Vazamento leve proximo ao box.', 'high', 'open'
    from units u
    join condos c on c.id = u.condo_id
    where c.name = 'Residencial Jardim Central'
      and u.tower = 'A'
      and u.number = '101'
      and not exists (
        select 1 from maintenance_requests mr
        where mr.unit_id = u.id and mr.title = 'Infiltracao banheiro'
      );

    insert into notices (condo_id, title, content, urgency, is_pinned, audience)
    select
      c.id,
      'Manutencao programada',
      'A manutencao da bomba dagua sera realizada na quarta-feira, das 9h as 11h.',
      'normal',
      true,
      'Todos os moradores'
    from condos c
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from notices n
        where n.condo_id = c.id and n.title = 'Manutencao programada'
      );

    -- Remover espacos de demonstracao legados (textos exatos do seed antigo)
    delete from space_reservations sr
    where exists (
      select 1 from reservation_spaces rs
      where rs.condo_id = sr.condo_id
        and rs.name = sr.space_name
        and (
          (rs.name = 'Salao de festas' and rs.description = 'Uso para eventos com confirmacao previa e checklist.')
          or (rs.name = 'Churrasqueira' and rs.description = 'Reserva com controle de horario e taxa quando aplicavel.')
        )
    );

    delete from space_reservations sr
    where sr.condo_id in (select id from condos where name = 'Residencial Jardim Central')
      and lower(sr.space_name) in (lower('Salao de festas'), lower('Churrasqueira'))
      and not exists (
        select 1 from reservation_spaces rs
        where rs.condo_id = sr.condo_id and rs.name = sr.space_name
      );

    delete from reservation_spaces rs
    where (rs.name = 'Salao de festas' and rs.description = 'Uso para eventos com confirmacao previa e checklist.')
       or (rs.name = 'Churrasqueira' and rs.description = 'Reserva com controle de horario e taxa quando aplicavel.');

    insert into app_users (condo_id, unit_id, full_name, login, password_plain, role, active)
    select c.id, null, 'Carlos Sindico', 'sindico', 'sindico', 'syndic', true
    from (select id from condos where name = 'Residencial Jardim Central' order by id asc limit 1) c
    where true
      and not exists (select 1 from app_users au where lower(au.login) = lower('sindico'));

    insert into app_users (condo_id, unit_id, full_name, login, password_plain, role, active)
    select c.id, null, 'Ana Administradora', 'administradora', 'administradora', 'administrator', true
    from (select id from condos where name = 'Residencial Jardim Central' order by id asc limit 1) c
    where true
      and not exists (select 1 from app_users au where lower(au.login) = lower('administradora'));

    insert into app_users (condo_id, unit_id, full_name, login, password_plain, role, active)
    select c.id, u.id, 'Mariana Moradora', 'morador', 'morador', 'resident', true
    from (select id from condos where name = 'Residencial Jardim Central' order by id asc limit 1) c
    join units u on u.condo_id = c.id and u.tower = 'B' and u.number = '202'
    where true
      and not exists (select 1 from app_users au where lower(au.login) = lower('morador'));

    insert into app_users (condo_id, unit_id, full_name, login, password_plain, role, active)
    select c.id, null, 'Paulo Parceiro', 'parceiro', 'parceiro', 'partner', true
    from (select id from condos where name = 'Residencial Jardim Central' order by id asc limit 1) c
    on conflict (login) do update set
      condo_id = excluded.condo_id,
      unit_id = excluded.unit_id,
      full_name = excluded.full_name,
      password_plain = excluded.password_plain,
      role = excluded.role,
      active = excluded.active;

    insert into app_users (condo_id, unit_id, full_name, login, password_plain, role, active)
    select c.id, null, 'Pedro Portaria', 'portaria', 'portaria', 'doorman', true
    from (select id from condos where name = 'Residencial Jardim Central' order by id asc limit 1) c
    on conflict (login) do update set
      condo_id = excluded.condo_id,
      unit_id = excluded.unit_id,
      full_name = excluded.full_name,
      password_plain = excluded.password_plain,
      role = excluded.role,
      active = excluded.active;

    insert into app_users (condo_id, unit_id, full_name, login, password_plain, role, active)
    select c.id, null, 'Laura Colaboradora', 'colaborador', 'colaborador', 'collaborator', true
    from (select id from condos where name = 'Residencial Jardim Central' order by id asc limit 1) c
    on conflict (login) do update set
      condo_id = excluded.condo_id,
      unit_id = excluded.unit_id,
      full_name = excluded.full_name,
      password_plain = excluded.password_plain,
      role = excluded.role,
      active = excluded.active;

    -- Mantem os logins de demonstracao no mesmo condominio base dos dados seed.
    -- Se existirem condominios duplicados com o mesmo nome, usa sempre o menor id.
    with demo_condo as (
      select id
      from (
        select au.condo_id as id, 0 as priority
        from app_users au
        where lower(au.login) = lower('sindico')
        union all
        select c.id, 1 as priority
        from condos c
        where c.name = 'Residencial Jardim Central'
        union all
        select c.id, 2 as priority
        from condos c
      ) candidates
      order by priority asc, id asc
      limit 1
    ),
    demo_unit as (
      select u.id
      from units u
      join demo_condo dc on dc.id = u.condo_id
      where u.tower = 'B' and u.number = '202'
      order by u.id asc
      limit 1
    )
    update app_users au
    set condo_id = dc.id,
        unit_id = case
          when lower(au.login) = lower('morador') then (select id from demo_unit)
          else null
        end,
        role = case lower(au.login)
          when lower('sindico') then 'syndic'
          when lower('administradora') then 'administrator'
          when lower('morador') then 'resident'
          when lower('parceiro') then 'partner'
          when lower('colaborador') then 'collaborator'
          when lower('portaria') then 'doorman'
          else au.role
        end,
        active = true
    from demo_condo dc
    where lower(au.login) in (
      lower('sindico'),
      lower('administradora'),
      lower('morador'),
      lower('parceiro'),
      lower('colaborador'),
      lower('portaria')
    );

    insert into app_users (condo_id, unit_id, full_name, login, password_plain, role, active)
    select c.id, null, 'Administrador Plataforma', 'admin_plataforma', 'admin123', 'admin', true
    from (select id from condos order by id asc limit 1) as c(id)
    where not exists (select 1 from app_users au where lower(au.login) = lower('admin_plataforma'));

    insert into events (
      condo_id, title, description, event_date, event_end, location, visibility, created_by_user_id
    )
    select c.id,
           'Feira de servicos',
           'Prestadores e parceiros do condominio reunidos no terreo.',
           now() + interval '7 day',
           now() + interval '7 day' + interval '6 hours',
           'Hall principal',
           'public',
           au.id
    from condos c
    join app_users au on au.condo_id = c.id and au.role = 'syndic'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from events e where e.condo_id = c.id and e.title = 'Feira de servicos'
      );

    insert into events (
      condo_id, title, description, event_date, location, visibility, created_by_user_id
    )
    select c.id,
           'Reuniao privada do conselho',
           'Pauta interna: visivel apenas para sindico e administracao.',
           now() + interval '3 day',
           'Sala da administracao',
           'private',
           au.id
    from condos c
    join app_users au on au.condo_id = c.id and au.role = 'syndic'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from events e
        where e.condo_id = c.id and e.title = 'Reuniao privada do conselho'
      );

    insert into condo_polls (condo_id, kind, title, description, status, created_by_user_id)
    select c.id, 'survey', 'Horario preferencial da piscina',
           'Enquete para definir faixa de limpeza semanal.', 'open', au.id
    from condos c
    join app_users au on au.condo_id = c.id and au.role = 'syndic'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from condo_polls p
        where p.condo_id = c.id and p.title = 'Horario preferencial da piscina'
      );

    insert into condo_poll_options (poll_id, label, sort_order)
    select p.id, v.label, v.ord
    from condo_polls p
    cross join (values
      ('Manha (6h-10h)', 0),
      ('Tarde (14h-18h)', 1),
      ('Noite (18h-22h)', 2)
    ) as v(label, ord)
    where p.title = 'Horario preferencial da piscina'
      and p.condo_id = (select id from condos where name = 'Residencial Jardim Central' limit 1)
      and not exists (select 1 from condo_poll_options o where o.poll_id = p.id);

    insert into condo_poll_votes (poll_id, user_id, option_id)
    select p.id, u.id, o.id
    from condo_polls p
    join app_users u on u.condo_id = p.condo_id and lower(u.login) = lower('morador')
    join condo_poll_options o on o.poll_id = p.id and o.sort_order = 0
    where p.title = 'Horario preferencial da piscina'
      and not exists (select 1 from condo_poll_votes v where v.poll_id = p.id and v.user_id = u.id);

    insert into condo_polls (condo_id, kind, title, description, status, created_by_user_id)
    select c.id, 'formal_ballot', 'Aprovacao do aditivo do regimento interno',
           'Votacao formal — uma opcao por morador.', 'closed', au.id
    from condos c
    join app_users au on au.condo_id = c.id and au.role = 'syndic'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from condo_polls p
        where p.condo_id = c.id and p.title = 'Aprovacao do aditivo do regimento interno'
      );

    insert into condo_poll_options (poll_id, label, sort_order)
    select p.id, v.label, v.ord
    from condo_polls p
    cross join (values
      ('Sim', 0),
      ('Nao', 1),
      ('Abstencao', 2)
    ) as v(label, ord)
    where p.title = 'Aprovacao do aditivo do regimento interno'
      and p.condo_id = (select id from condos where name = 'Residencial Jardim Central' limit 1)
      and not exists (select 1 from condo_poll_options o where o.poll_id = p.id);

    insert into condo_collaborators (
      condo_id, full_name, job_title, phone, sort_order, created_by_user_id
    )
    select c.id, 'Joao Porteiro', 'Portaria 24h', '(11) 99999-0001', 0, au.id
    from condos c
    join app_users au on au.condo_id = c.id and au.role = 'syndic'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from condo_collaborators cc
        where cc.condo_id = c.id and cc.full_name = 'Joao Porteiro'
      );

    insert into condo_service_catalog (
      condo_id, title, description, category, provider_name, provider_phone, sort_order,
      created_by_user_id
    )
    select c.id,
           'Manutencao hidraulica predial',
           'Pequenos reparos em apartamentos: torneiras, vasos, registros.',
           'Manutencao',
           'Hidro Express Ltda',
           '(11) 98888-1234',
           0,
           au.id
    from condos c
    join app_users au on au.condo_id = c.id and au.role = 'syndic'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from condo_service_catalog s
        where s.condo_id = c.id and s.title = 'Manutencao hidraulica predial'
      );

    update units u
    set monthly_fee = 520,
        reserve_fund_fee = 95,
        billing_active = true
    from condos c
    where u.condo_id = c.id
      and c.name = 'Residencial Jardim Central'
      and u.monthly_fee = 0
      and u.reserve_fund_fee = 0;

    insert into condo_access_service_providers (
      condo_id, company_name, notes, access_window_start, access_window_end, active, created_by_user_id
    )
    select c.id,
           'Equipe Limpa Tudo',
           'Prestador recorrente — janela em dias de servico.',
           time '08:00',
           time '17:00',
           true,
           au.id
    from condos c
    join app_users au on au.condo_id = c.id and au.role = 'syndic'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from condo_access_service_providers p
        where p.condo_id = c.id and p.company_name = 'Equipe Limpa Tudo'
      );

    insert into condo_access_visitor_passes (
      condo_id, unit_id, visitor_full_name, visitor_phone, valid_from, valid_until,
      status, pin_code, qr_token, notes, created_by_user_id
    )
    select c.id,
           u.id,
           'Ana Pereira',
           '(11) 98888-1111',
           now() - interval '1 hour',
           now() + interval '5 hours',
           'pending',
           '482915',
           'a1111111-1111-4111-8111-111111111111'::uuid,
           'Visitante autorizada — unidade B-202',
           au.id
    from condos c
    join units u on u.condo_id = c.id and u.tower = 'B' and u.number = '202'
    join app_users au on au.condo_id = c.id and au.role = 'syndic'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from condo_access_visitor_passes vp
        where vp.condo_id = c.id
          and vp.visitor_full_name = 'Ana Pereira'
          and vp.unit_id = u.id
      );

    insert into condo_access_visitor_passes (
      condo_id, unit_id, visitor_full_name, visitor_phone, valid_from, valid_until,
      status, pin_code, qr_token, notes, created_by_user_id
    )
    select c.id,
           u.id,
           'Rafael Gomes',
           '(11) 97777-2222',
           date_trunc('day', now()),
           date_trunc('day', now()) + interval '1 day',
           'inside',
           '551029',
           'b2222222-2222-4222-8222-222222222222'::uuid,
           'No predio — saida pendente',
           au.id
    from condos c
    join units u on u.condo_id = c.id and u.tower = 'A' and u.number = '101'
    join app_users au on au.condo_id = c.id and au.role = 'syndic'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from condo_access_visitor_passes vp
        where vp.condo_id = c.id
          and vp.visitor_full_name = 'Rafael Gomes'
          and vp.unit_id = u.id
      );

    insert into condo_access_events (
      condo_id, unit_id, visitor_pass_id, service_provider_id, direction, method, subject_name, recorded_at, notes
    )
    select c.id,
           vp.unit_id,
           vp.id,
           null,
           'in',
           'qr',
           vp.visitor_full_name,
           now() - interval '25 minutes',
           'Validacao QR — portaria'
    from condos c
    join condo_access_visitor_passes vp on vp.condo_id = c.id and vp.visitor_full_name = 'Ana Pereira'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from condo_access_events e
        where e.visitor_pass_id = vp.id and e.direction = 'in'
      );

    insert into condo_access_events (
      condo_id, unit_id, visitor_pass_id, service_provider_id, direction, method, subject_name, recorded_at, notes
    )
    select c.id,
           vp.unit_id,
           vp.id,
           null,
           'in',
           'pin',
           vp.visitor_full_name,
           now() - interval '3 hours',
           'Codigo numerico'
    from condos c
    join condo_access_visitor_passes vp on vp.condo_id = c.id and vp.visitor_full_name = 'Rafael Gomes'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from condo_access_events e
        where e.visitor_pass_id = vp.id and e.direction = 'in'
      );

    insert into condo_access_events (
      condo_id, unit_id, visitor_pass_id, service_provider_id, direction, method, subject_name, recorded_at, notes
    )
    select sp.condo_id,
           null,
           null,
           sp.id,
           'in',
           'manual',
           sp.company_name,
           date_trunc('day', now()) + time '08:15',
           'Equipe de limpeza — entrada'
    from condo_access_service_providers sp
    join condos c on c.id = sp.condo_id and c.name = 'Residencial Jardim Central'
    where sp.company_name = 'Equipe Limpa Tudo'
      and not exists (
        select 1 from condo_access_events e
        where e.service_provider_id = sp.id
          and e.subject_name = sp.company_name
          and e.recorded_at::date = current_date
      );


    insert into condo_video_rooms (
      condo_id, title, description, room_slug, status, created_by_user_id
    )
    select c.id,
           'Canal do condominio',
           'Sala permanente para reunioes abertas aos moradores.',
           'condo-jardim-central-reuniao-geral',
           'live',
           au.id
    from condos c
    join app_users au on au.condo_id = c.id and au.role = 'syndic'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from condo_video_rooms v
        where v.room_slug = 'condo-jardim-central-reuniao-geral'
      );

    insert into condo_virtual_assemblies (
      condo_id, title, description, status, scheduled_starts_at,
      video_room_id, created_by_user_id
    )
    select c.id,
           'Assembleia ordinaria virtual',
           'Leitura de pauta e encaminhamentos. Use a sala de video vinculada no horario.',
           'scheduled',
           now() + interval '14 day',
           v.id,
           au.id
    from condos c
    join app_users au on au.condo_id = c.id and au.role = 'syndic'
    join condo_video_rooms v
      on v.condo_id = c.id and v.room_slug = 'condo-jardim-central-reuniao-geral'
    where c.name = 'Residencial Jardim Central'
      and not exists (
        select 1 from condo_virtual_assemblies a
        where a.condo_id = c.id and a.title = 'Assembleia ordinaria virtual'
      );

  `);
}
