import { Router } from 'express';

import { query } from '../db';

const router = Router();

function overlapsUtcDay(dayYmd: string, startMs: number, endMs: number): boolean {
  const parts = dayYmd.split('-').map(Number);
  const y = parts[0];
  const mo = parts[1];
  const d = parts[2];
  if (y === undefined || mo === undefined || d === undefined) {
    return false;
  }
  const dayStart = Date.UTC(y, mo - 1, d);
  const dayEnd = dayStart + 86400000;
  return startMs < dayEnd && endMs > dayStart;
}

function parseCondoId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return 1;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const result = await query(
      `select id, condo_id, name, description, icon_key, capacity,
              requires_approval, active, created_at
       from reservation_spaces
       where condo_id = $1 and active = true
       order by name asc`,
      [condoId],
    );

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const {
      condoId: rawCondoId,
      name,
      description,
      iconKey = 'meeting_room',
      capacity,
      requiresApproval = true,
    } = (req.body || {}) as {
      condoId?: number;
      name?: string;
      description?: string;
      iconKey?: string;
      capacity?: number | null;
      requiresApproval?: boolean;
    };

    const condoId = parseCondoId(rawCondoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const trimmedName = name?.trim();
    const trimmedDescription = description?.trim();
    if (!trimmedName || !trimmedDescription) {
      return res.status(400).json({
        message: 'name e description sao obrigatorios.',
      });
    }

    const condo = await query('select id from condos where id = $1', [condoId]);
    if (condo.rows.length === 0) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    const result = await query(
      `insert into reservation_spaces (
         condo_id,
         name,
         description,
         icon_key,
         capacity,
         requires_approval
       )
       values ($1, $2, $3, $4, $5, $6)
       returning id, condo_id, name, description, icon_key, capacity,
                 requires_approval, active, created_at`,
      [
        condoId,
        trimmedName,
        trimmedDescription,
        iconKey,
        capacity ?? null,
        Boolean(requiresApproval),
      ],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.get('/my-reservations', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const unitId = Number(req.query.unitId);
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return res.status(400).json({ message: 'unitId invalido.' });
    }

    const unitOk = await query(
      `select 1 from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (unitOk.rows.length === 0) {
      return res.status(400).json({ message: 'Unidade invalida.' });
    }

    const r = await query(
      `select sr.id,
              sr.space_name,
              sr.starts_at,
              sr.ends_at,
              sr.status,
              rs.id as reservation_space_id
       from space_reservations sr
       left join reservation_spaces rs
         on rs.condo_id = sr.condo_id
        and rs.name = sr.space_name
        and rs.active = true
       where sr.condo_id = $1
         and sr.unit_id = $2
         and sr.status in ('pending', 'approved')
         and sr.ends_at > now()
       order by sr.starts_at asc`,
      [condoId, unitId],
    );

    return res.json(r.rows);
  } catch (error) {
    return next(error);
  }
});

router.patch('/reservations/:id/cancel', async (req, res, next) => {
  try {
    const reservationId = Number(req.params.id);
    if (!Number.isFinite(reservationId) || reservationId <= 0) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const body = (req.body || {}) as {
      condoId?: unknown;
      unitId?: unknown;
    };
    const condoId = parseCondoId(body.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const unitId = Number(body.unitId);
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return res.status(400).json({ message: 'unitId invalido.' });
    }

    const result = await query(
      `update space_reservations
       set status = 'cancelled'
       where id = $1
         and condo_id = $2
         and unit_id = $3
         and status in ('pending', 'approved')
       returning id, space_name, starts_at, ends_at, status`,
      [reservationId, condoId, unitId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Reserva nao encontrada ou nao pode ser cancelada.',
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/calendar', async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      month < 1 ||
      month > 12
    ) {
      return res.status(400).json({ message: 'year e month (1-12) obrigatorios.' });
    }

    const spaceResult = await query(
      `select id, name, condo_id
       from reservation_spaces
       where id = $1 and condo_id = $2 and active = true`,
      [spaceId, condoId],
    );
    if (spaceResult.rows.length === 0) {
      return res.status(404).json({ message: 'Espaco nao encontrado.' });
    }

    const spaceName = spaceResult.rows[0].name as string;
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));

    const resv = await query(
      `select starts_at, ends_at, status
       from space_reservations
       where condo_id = $1
         and space_name = $2
         and status in ('pending', 'approved')
         and starts_at < $4::timestamptz
         and ends_at > $3::timestamptz`,
      [condoId, spaceName, monthStart.toISOString(), monthEnd.toISOString()],
    );

    const bookings = resv.rows.map((row) => ({
      start: new Date(row.starts_at as string).getTime(),
      end: new Date(row.ends_at as string).getTime(),
      status: String(row.status),
    }));

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const todayStr = new Date().toISOString().slice(0, 10);
    type DayCell = 'free' | 'pending' | 'approved' | 'past';
    const days: { date: string; cell: DayCell; available: boolean }[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isPast = dateStr < todayStr;
      let cell: DayCell;
      if (isPast) {
        cell = 'past';
      } else {
        const overlapping = bookings.filter((b) =>
          overlapsUtcDay(dateStr, b.start, b.end),
        );
        const hasApproved = overlapping.some((b) => b.status === 'approved');
        const hasPending = overlapping.some((b) => b.status === 'pending');
        if (hasApproved) {
          cell = 'approved';
        } else if (hasPending) {
          cell = 'pending';
        } else {
          cell = 'free';
        }
      }
      days.push({ date: dateStr, cell, available: cell === 'free' });
    }

    return res.json({ year, month, spaceId, days });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/reservations', async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const body = (req.body || {}) as {
      condoId?: unknown;
      unitId?: unknown;
      date?: unknown;
      requesterName?: unknown;
    };

    const condoId = parseCondoId(body.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const trimmedDate =
      typeof body.date === 'string' ? body.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      return res.status(400).json({ message: 'date invalido (YYYY-MM-DD).' });
    }

    const unitId = Number(body.unitId);
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return res.status(400).json({ message: 'unitId invalido.' });
    }

    const spaceResult = await query(
      `select id, name
       from reservation_spaces
       where id = $1 and condo_id = $2 and active = true`,
      [spaceId, condoId],
    );
    if (spaceResult.rows.length === 0) {
      return res.status(404).json({ message: 'Espaco nao encontrado.' });
    }
    const spaceName = spaceResult.rows[0].name as string;

    const unitCheck = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (unitCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Unidade invalida.' });
    }

    const requesterName =
      typeof body.requesterName === 'string'
        ? body.requesterName.trim().slice(0, 150) || null
        : null;

    const parts = trimmedDate.split('-').map(Number);
    const y = parts[0];
    const mo = parts[1];
    const da = parts[2];
    if (y === undefined || mo === undefined || da === undefined) {
      return res.status(400).json({ message: 'date invalido.' });
    }

    // Um único dia civil na grade do calendário (YYYY-MM-DD em UTC), intervalo
    // meia-aberto [início do dia, início do dia seguinte). Evita o bug do intervalo
    // 12h–12h UTC, que intersectava dois dias em overlapsUtcDay.
    const startIso = new Date(Date.UTC(y, mo - 1, da, 0, 0, 0)).toISOString();
    const endIso = new Date(Date.UTC(y, mo - 1, da + 1, 0, 0, 0)).toISOString();

    const conflict = await query(
      `select 1 from space_reservations
       where condo_id = $1
         and space_name = $2
         and status in ('pending', 'approved')
         and starts_at < $4::timestamptz
         and ends_at > $3::timestamptz
       limit 1`,
      [condoId, spaceName, startIso, endIso],
    );
    if (conflict.rows.length > 0) {
      return res.status(409).json({ message: 'Data indisponivel.' });
    }

    const insert = await query(
      `insert into space_reservations (
         condo_id,
         unit_id,
         space_name,
         starts_at,
         ends_at,
         status,
         requester_name
       )
       values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'pending', $6)
       returning id, starts_at, ends_at, status`,
      [condoId, unitId, spaceName, startIso, endIso, requesterName],
    );

    return res.status(201).json(insert.rows[0]);
  } catch (error) {
    return next(error);
  }
});

export default router;
