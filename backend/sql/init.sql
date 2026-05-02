create table if not exists condos (
  id serial primary key,
  name varchar(150) not null,
  created_at timestamptz not null default now()
);

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

create table if not exists events (
  id serial primary key,
  condo_id integer not null references condos(id) on delete cascade,
  title varchar(150) not null,
  description text,
  event_date timestamptz not null,
  location varchar(150)
);

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
    select 1 from units u where u.condo_id = c.id and u.tower = 'A' and u.number = '101'
  );

insert into units (condo_id, tower, number, resident_name)
select c.id, 'B', '202', 'Mariana Costa'
from condos c
where c.name = 'Residencial Jardim Central'
  and not exists (
    select 1 from units u where u.condo_id = c.id and u.tower = 'B' and u.number = '202'
  );

insert into notices (condo_id, title, content)
select c.id, 'Manutencao programada', 'A manutencao da bomba dagua sera realizada na quarta-feira, das 9h as 11h.'
from condos c
where c.name = 'Residencial Jardim Central'
  and not exists (
    select 1 from notices n where n.condo_id = c.id and n.title = 'Manutencao programada'
  );

insert into notices (condo_id, title, content)
select c.id, 'Assembleia ordinaria', 'A assembleia ordinaria sera realizada no salao de festas na proxima sexta-feira.'
from condos c
where c.name = 'Residencial Jardim Central'
  and not exists (
    select 1 from notices n where n.condo_id = c.id and n.title = 'Assembleia ordinaria'
  );

insert into events (condo_id, title, description, event_date, location)
select c.id, 'Feira de servicos', 'Prestadores e parceiros do condominio reunidos no terreo.', now() + interval '7 day', 'Hall principal'
from condos c
where c.name = 'Residencial Jardim Central'
  and not exists (
    select 1 from events e where e.condo_id = c.id and e.title = 'Feira de servicos'
  );

insert into app_modules (code, name, icon_key, display_order)
values
  ('sindico', 'Area do Sindico', 'account_balance', 1),
  ('administradora', 'Administradora', 'business', 2),
  ('minha_unidade', 'Minha Unidade', 'apartment', 3),
  ('controle_acesso', 'Controle de Acesso', 'badge', 4),
  ('boleto_online', 'Boleto Online', 'receipt_long', 5),
  ('ofertas', 'Ofertas', 'local_offer', 6),
  ('fale_condominio', 'Fale com o Condominio', 'forum', 7),
  ('reservas', 'Reservas de Espaco', 'event_available', 8)
on conflict (code) do update
set
  name = excluded.name,
  icon_key = excluded.icon_key,
  display_order = excluded.display_order,
  enabled = true;

alter table notices add column if not exists is_pinned boolean not null default false;
alter table notices add column if not exists is_archived boolean not null default false;
alter table notices add column if not exists urgency varchar(20) not null default 'normal';
alter table notices add column if not exists audience varchar(120);
alter table notices add column if not exists expires_at timestamptz;

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

alter table space_reservations add column if not exists requester_name varchar(150);

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

create unique index if not exists reservation_spaces_condo_name_idx
  on reservation_spaces (condo_id, lower(name));

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

insert into occurrences (condo_id, unit_id, title, description, category, status)
select c.id, u.id, 'Ruido excessivo', 'Relato de barulho apos 22h.', 'Convivencia', 'open'
from condos c
cross join lateral (
  select id from units where condo_id = c.id limit 1
) u
where c.name = 'Residencial Jardim Central'
  and not exists (select 1 from occurrences where title = 'Ruido excessivo' and condo_id = c.id);

insert into occurrences (condo_id, unit_id, title, description, category, status)
select c.id, null, 'Portao lateral com rangido', 'Manutencao preventiva solicitada na portaria.', 'Infraestrutura', 'open'
from condos c
where c.name = 'Residencial Jardim Central'
  and not exists (select 1 from occurrences where title = 'Portao lateral com rangido' and condo_id = c.id);

insert into occurrences (condo_id, unit_id, title, description, category, status, resolved_at)
select c.id, u.id, 'Lampada queimada corredor', 'Substituicao realizada pela equipe.', 'Iluminacao', 'closed', now() - interval '2 day'
from condos c
cross join lateral (
  select id from units where condo_id = c.id offset 1 limit 1
) u
where c.name = 'Residencial Jardim Central'
  and not exists (select 1 from occurrences where title = 'Lampada queimada corredor' and condo_id = c.id);

insert into maintenance_requests (unit_id, title, description, priority, status)
select u.id, 'Infiltracao banheiro', 'Vazamento leve proximo ao box.', 'high', 'open'
from units u
join condos c on c.id = u.condo_id
where c.name = 'Residencial Jardim Central' and u.tower = 'A' and u.number = '101'
  and not exists (
    select 1 from maintenance_requests mr
    where mr.unit_id = u.id and mr.title = 'Infiltracao banheiro'
  );

insert into maintenance_requests (unit_id, title, description, priority, status)
select u.id, 'Porta da academia emperrada', 'Ajuste de dobradicas agendado.', 'normal', 'in_progress'
from units u
join condos c on c.id = u.condo_id
where c.name = 'Residencial Jardim Central' and u.tower = 'B' and u.number = '202'
  and not exists (
    select 1 from maintenance_requests mr
    where mr.unit_id = u.id and mr.title = 'Porta da academia emperrada'
  );

insert into registration_requests (condo_id, unit_id, request_type, full_name, details, status)
select c.id, u.id, 'resident', 'Fernanda Rezende', 'Novo morador - documentos em analise.', 'pending'
from condos c
join units u on u.condo_id = c.id
where c.name = 'Residencial Jardim Central' and u.tower = 'A' and u.number = '101'
  and not exists (
    select 1 from registration_requests rr
    where rr.condo_id = c.id and rr.full_name = 'Fernanda Rezende'
  );

insert into registration_requests (condo_id, unit_id, request_type, full_name, details, status)
select c.id, u.id, 'visitor', 'Visitante Lucas Mendes', 'Liberacao temporaria para obra na unidade B-202.', 'pending'
from condos c
join units u on u.condo_id = c.id
where c.name = 'Residencial Jardim Central' and u.tower = 'B' and u.number = '202'
  and not exists (
    select 1 from registration_requests rr
    where rr.condo_id = c.id and rr.full_name = 'Visitante Lucas Mendes'
  );

insert into mass_communications (condo_id, subject, message, audience)
select c.id, 'Limpeza das caixas d agua', 'Interrupcao programada das 8h as 12h.', 'Todos os moradores'
from condos c
where c.name = 'Residencial Jardim Central'
  and not exists (
    select 1 from mass_communications m
    where m.condo_id = c.id and m.subject = 'Limpeza das caixas d agua'
  );

insert into financial_entries (condo_id, entry_month, type, category, amount, description)
select c.id, date_trunc('month', current_date)::date, 'revenue', 'Taxa condominial', 185420.00, 'Arrecadacao prevista do mes'
from condos c
where c.name = 'Residencial Jardim Central'
  and not exists (
    select 1 from financial_entries f
    where f.condo_id = c.id and f.entry_month = date_trunc('month', current_date)::date
      and f.category = 'Taxa condominial' and f.type = 'revenue'
  );

insert into financial_entries (condo_id, entry_month, type, category, amount, description)
select c.id, date_trunc('month', current_date)::date, 'expense', 'Manutencao predial', 32400.00, 'Contratos de manutencao'
from condos c
where c.name = 'Residencial Jardim Central'
  and not exists (
    select 1 from financial_entries f
    where f.condo_id = c.id and f.entry_month = date_trunc('month', current_date)::date
      and f.category = 'Manutencao predial' and f.type = 'expense'
  );

insert into occurrences (condo_id, unit_id, title, description, category, status)
select c.id, null, v.title, v.description, v.category, 'open'
from condos c
cross join (values
  ('Elevador com odor estranho', 'Solicitada limpeza do poço.', 'Higiene'),
  ('Piscina com cloro baixo', 'Teste da agua abaixo do ideal.', 'Areas comuns'),
  ('Vaga visitante ocupada indevidamente', 'Registro na portaria.', 'Convivencia'),
  ('Som automotor no tellado', 'Equipamento da casa de maquinas.', 'Operacao'),
  ('Sensor de presenca halls', 'Falso disparo noturno.', 'Seguranca'),
  ('Entrega correio atrasada', 'Central sem registro de duas encomendas.', 'Administrativo'),
  ('Vazamento garagem B1', 'Mancha de agua proxima a coluna.', 'Infraestrutura'),
  ('Academia fechada cedo', 'Porta trancada antes do horario.', 'Areas comuns'),
  ('Iluminacao quadra', 'Um refletor apagado.', 'Iluminacao'),
  ('Jardinagem descuidada', 'Canteiro sem irrigacao em um trecho.', 'Paisagismo')
) as v(title, description, category)
where c.name = 'Residencial Jardim Central'
  and not exists (
    select 1 from occurrences o where o.condo_id = c.id and o.title = v.title
  );

insert into maintenance_requests (unit_id, title, description, priority, status)
select u.id, v.title, v.description, v.priority, v.status
from units u
join condos c on c.id = u.condo_id
cross join (values
  ('Torneira cozinha', 'Gotejamento constante.', 'normal', 'open'),
  ('Interfone sala de jogos', 'Audio com ruido.', 'normal', 'open'),
  ('Tomada area gourmet', 'Sem energia.', 'high', 'in_progress'),
  ('Ralo piscina', 'Escoamento lento.', 'normal', 'open'),
  ('Cerca eletrica setor L', 'Alarme intermittente.', 'high', 'open'),
  ('Porta social empenada', 'Dificuldade ao fechar.', 'normal', 'in_progress')
) as v(title, description, priority, status)
where c.name = 'Residencial Jardim Central' and u.tower = 'A' and u.number = '101'
  and not exists (select 1 from maintenance_requests mr where mr.unit_id = u.id and mr.title = v.title);

insert into space_reservations (condo_id, unit_id, space_name, starts_at, ends_at, status)
select c.id, u.id, 'Quadra esportiva',
  now() + interval '8 day', now() + interval '8 day' + interval '2 hour', 'pending'
from condos c
join units u on u.condo_id = c.id
where c.name = 'Residencial Jardim Central' and u.tower = 'A' and u.number = '101'
  and not exists (
    select 1 from space_reservations sr
    where sr.condo_id = c.id and sr.unit_id = u.id and sr.space_name = 'Quadra esportiva'
      and sr.status = 'pending'
  );

insert into space_reservations (condo_id, unit_id, space_name, starts_at, ends_at, status)
select c.id, u.id, 'Espaco Gourmet',
  now() + interval '12 day', now() + interval '12 day' + interval '5 hour', 'pending'
from condos c
join units u on u.condo_id = c.id
where c.name = 'Residencial Jardim Central' and u.tower = 'B' and u.number = '202'
  and not exists (
    select 1 from space_reservations sr
    where sr.condo_id = c.id and sr.unit_id = u.id and sr.space_name = 'Espaco Gourmet'
      and sr.status = 'pending'
  );

insert into registration_requests (condo_id, unit_id, request_type, full_name, details, status)
select c.id, u.id, 'resident', v.name, v.details, 'pending'
from condos c
join units u on u.condo_id = c.id
cross join (values
  ('Joao Martins', 'Proprietario novo - doc pendente'),
  ('Paula Nogueira', 'Atualizacao cadastral moradora'),
  ('Empresa Telas Ltda', 'Prestador recorrente cadastro'),
  ('Mario Souza', 'Autorizacao curta visitante'),
  ('Amanda Dias', 'Troca de responsavel pela unidade')
) as v(name, details)
where c.name = 'Residencial Jardim Central' and u.tower = 'A' and u.number = '101'
  and not exists (
    select 1 from registration_requests rr
    where rr.condo_id = c.id and rr.full_name = v.name
  );

insert into notices (condo_id, title, content, urgency, is_pinned, audience)
select c.id, v.titulo, v.corpo, v.urg, v.pin, v.aud
from condos c
cross join (values
  (
    'Urgente: desabastecimento agua',
    'Manutencao emergencial 14h-18h.',
    'urgent',
    true,
    'Todos os moradores'
  ),
  (
    'Campanha de reciclaveis',
    'Coleta extra na proxima terca.',
    'normal',
    false,
    'Todos os moradores'
  ),
  (
    'Regra estacionamento visitantes',
    'Permanencia maxima 3 horas.',
    'normal',
    false,
    'Somente proprietarios'
  )
) as v(titulo, corpo, urg, pin, aud)
where c.name = 'Residencial Jardim Central'
  and not exists (select 1 from notices n where n.condo_id = c.id and n.title = v.titulo);
