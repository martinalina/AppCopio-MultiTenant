// src/services/crossSupportService.ts
//
// Colaboración intercomunal: tablero de centros compartidos y ofertas de apoyo.
//
// Regla dura del proyecto: entre comunas solo cruzan ubicación, capacidad, % de
// llenado, estado operacional y prioridades. Nunca personas, familias, catastro
// ni cantidades de inventario. El tablero se arma con super_event_shared_centers(),
// que ya limita los campos en la propia base de datos.
import { Db } from '../types/db';

export type EstadoOferta = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export type CentroCompartido = {
  center_id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  capacity: number | null;
  fullness_percentage: number | null;
  operational_status: string | null;
  municipality_id: number;
  municipality_shortname: string;
  activation_id: number;
  /** Emergencia local que aporta este centro al SuperEvento. */
  emergency_id: number;
  emergency_name: string;
  prioridades: { item_id: number; item_name: string; priority: string }[];
};

/**
 * Centros activos de las comunas participantes, con sus prioridades.
 *
 * Excluye los centros de la propia comuna: el tablero es para ver a quién se le
 * puede ofrecer apoyo, y los propios ya se ven en el panel municipal.
 */
export async function getBoard(db: Db, superEventId: number, ownMunicipalityId: number | null) {
  const { rows: centros } = await db.query(
    `SELECT * FROM super_event_shared_centers($1)`,
    [superEventId]
  );

  const ajenos = centros.filter((c: any) => c.municipality_id !== ownMunicipalityId);
  if (ajenos.length === 0) return [];

  // Las prioridades ya son legibles gracias a cip_intermunicipal_read; basta pedirlas.
  const ids = ajenos.map((c: any) => c.center_id);
  const { rows: prioridades } = await db.query(
    `SELECT cip.center_id, cip.item_id, p.name AS item_name, cip.priority
       FROM CenterItemPriority cip
       JOIN Products p ON p.item_id = cip.item_id
      WHERE cip.center_id = ANY($1::varchar[])
      ORDER BY CASE cip.priority WHEN 'alto' THEN 1 WHEN 'medio' THEN 2 ELSE 3 END`,
    [ids]
  );

  const porCentro = new Map<string, any[]>();
  for (const pr of prioridades) {
    if (!porCentro.has(pr.center_id)) porCentro.set(pr.center_id, []);
    porCentro.get(pr.center_id)!.push({
      item_id: pr.item_id,
      item_name: pr.item_name,
      priority: pr.priority,
    });
  }

  return ajenos.map((c: any) => ({ ...c, prioridades: porCentro.get(c.center_id) ?? [] }));
}

/**
 * Ofertas visibles para la comuna del request.
 *
 * La política cmso_read ya limita a las que la comuna envió o recibió; el filtro
 * `box` solo separa una bandeja de la otra.
 */
export async function listOffers(
  db: Db,
  ownMunicipalityId: number | null,
  box: 'enviadas' | 'recibidas' | 'todas'
) {
  // Vía función SECURITY DEFINER: un JOIN normal a Centers pasa por RLS, así que la
  // comuna que OFRECE no podría resolver el nombre del centro ajeno y el destino
  // saldría vacío. La función aplica la misma visibilidad que la política cmso_read.
  const { rows } = await db.query(`SELECT * FROM support_offers_visible()`);

  if (box === 'enviadas') return rows.filter((r: any) => r.from_municipality_id === ownMunicipalityId);
  if (box === 'recibidas') return rows.filter((r: any) => r.from_municipality_id !== ownMunicipalityId);
  return rows;
}

export async function createOffer(
  db: Db,
  input: {
    super_event_id: number;
    target_center_id: string;
    item_id?: number | null;
    message?: string | null;
    created_by: number;
    from_municipality_id: number;
  }
) {
  const { rows } = await db.query(
    `INSERT INTO CrossMunicipalSupportOffers
       (super_event_id, from_municipality_id, target_center_id, item_id, message, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING offer_id, super_event_id, from_municipality_id, target_center_id,
               item_id, message, status, created_at`,
    [
      input.super_event_id,
      input.from_municipality_id,
      input.target_center_id,
      input.item_id ?? null,
      input.message ?? null,
      input.created_by,
    ]
  );
  return rows[0];
}

/** Devuelve la oferta con los datos necesarios para decidir quién puede cambiarla. */
export async function getOfferForUpdate(db: Db, offerId: number) {
  // Misma función que el listado: un JOIN directo a Centers dejaría
  // target_municipality_id en NULL para la comuna que ofrece, porque el centro
  // destino es de otra comuna y RLS lo oculta.
  const { rows } = await db.query(
    `SELECT * FROM support_offers_visible() WHERE offer_id = $1`,
    [offerId]
  );
  return rows[0] ?? null;
}

export async function setOfferStatus(db: Db, offerId: number, status: EstadoOferta) {
  const { rows } = await db.query(
    `UPDATE CrossMunicipalSupportOffers
        SET status = $1
      WHERE offer_id = $2
      RETURNING offer_id, status`,
    [status, offerId]
  );
  return rows[0] ?? null;
}
