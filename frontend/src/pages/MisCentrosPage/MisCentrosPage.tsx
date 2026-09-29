import * as React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getUser } from "@/services/users.service";
import { listCenters } from "@/services/centers.service";
import { listEmergencies, listOpenActivations } from "@/services/superadmin.service";
import type { Center } from "@/types/center";
import { msgFromError } from "@/lib/errors";
import "./MisCentrosPage.css";

// Estado visible del centro en tarjeta
const getCenterStatus = (center: Center): string => {
  if (!center.is_active) return "Inactivo";
  if (center.operational_status === "cerrado temporalmente") return "Cerrado";
  return "Activo";
};

/**
 * A qué emergencia está unido cada centro, y si eso lo está exponiendo a otras comunas.
 *
 * El encargado consiente que su centro se sume a la emergencia local, pero la decisión
 * de colaborar con otras comunas la toma el administrador después. Sin esto, su único
 * rastro era la notificación del Buzón: un mensaje, no un estado que pueda consultar.
 */
type VinculoCentro = {
  emergencyName: string;
  /** Nombre del SuperEvento vigente que está compartiendo este centro, si lo hay. */
  superEventName: string | null;
};

export default function MisCentrosPage() {
  const { user } = useAuth();

  const [assignedCenters, setAssignedCenters] = React.useState<Center[]>([]);
  const [vinculos, setVinculos] = React.useState<Record<string, VinculoCentro>>({});
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!user?.user_id) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        // 1) Usuario con sus centros asignados
        const fullUser = await getUser(user.user_id, controller.signal);
        const assignedIds = new Set(((fullUser?.assignedCenters ?? []) as (string | number)[]).map(String));

        if (assignedIds.size === 0) {
          setAssignedCenters([]);
          return;
        }

        // 2) Todos los centros y filtramos por los asignados
        const allCenters = await listCenters(controller.signal);
        const userCenters = (allCenters || []).filter((c) =>
          assignedIds.has(String(c.center_id))
        );

        setAssignedCenters(userCenters);

        // 3) A qué emergencia está unido cada centro. Las dos consultas ya están
        //    acotadas por RLS a la propia comuna y no exigen rol de administrador.
        //    Si fallan, las tarjetas se muestran igual: es información añadida.
        try {
          const [activaciones, emergencias] = await Promise.all([
            listOpenActivations(),
            listEmergencies(),
          ]);
          if (controller.signal.aborted) return;

          const porEmergencia = new Map(emergencias.map((e) => [e.emergency_id, e]));
          const mapa: Record<string, VinculoCentro> = {};
          for (const a of activaciones) {
            if (a.emergency_id == null) continue;
            const em = porEmergencia.get(a.emergency_id);
            if (!em) continue;
            mapa[String(a.center_id)] = {
              emergencyName: em.name,
              // Solo un SuperEvento VIGENTE comparte: al cerrarlo la colaboración
              // termina, y seguir diciendo "compartido" sería falso.
              superEventName:
                em.super_event_id != null && em.super_event_ended_at == null
                  ? em.super_event_name
                  : null,
            };
          }
          setVinculos(mapa);
        } catch {
          // Sin vínculos que mostrar; el listado de centros sigue siendo útil.
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        console.error("Error al cargar detalles de los centros:", e);
        setError(msgFromError(e) || "No se pudieron cargar los datos de los centros asignados.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [user?.user_id]);

  if (isLoading) {
    return <div className="mis-centros-container">Cargando tus centros asignados...</div>;
  }

  if (error) {
    return <div className="mis-centros-container error-message">{error}</div>;
  }

  return (
    <div className="mis-centros-container">
      <div className="mc-header">
        <h1 className="ds-titlePage">Mis Centros Asignados</h1>
      </div>

      <p className="mc-subtitle">
        Selecciona un centro para ver sus detalles y gestionar su inventario.
      </p>

      {assignedCenters.length === 0 ? (
        <p className="no-centers-message">
          No tienes ningún centro asignado actualmente. Por favor, contacta a un administrador.
        </p>
      ) : (
        <>
          <div className="mc-results-info">
            <p>
              Mostrando {assignedCenters.length}{" "}
              {assignedCenters.length === 1 ? "centro asignado" : "centros asignados"}
            </p>
          </div>

          <ul className="mis-centros-list">
            {assignedCenters.map((center) => {
              const status = getCenterStatus(center);
              const esActivo = status === "Activo";
              const vinculo = vinculos[String(center.center_id)];
              return (
                <li
                  key={String(center.center_id)}
                  className={`mc-item ${esActivo ? "mc-active" : "mc-inactive"}`}
                >
                  <div className="mc-main">
                    <div className="mc-info">
                      <div className="mc-title-row">
                        <h3>{center.name}</h3>
                        <span className={`mc-status ${esActivo ? "mc-active" : "mc-inactive"}`}>
                          {status}
                        </span>
                        {/* El chip adelanta el estado de exposición; el detalle de qué se
                            comparte queda en el pie, para no estrujar la fila. */}
                        {vinculo?.superEventName && (
                          <span className="mc-chip-compartido">Compartido</span>
                        )}
                      </div>

                      <p className="mc-meta">
                        <span>{center.address}</span>
                        <span className="mc-dot" aria-hidden="true">·</span>
                        <span>{center.type}</span>
                      </p>

                      <p className={`mc-emergencia ${vinculo ? "" : "mc-emergencia-vacia"}`}>
                        <span className="mc-label">Emergencia:</span>{" "}
                        {vinculo ? vinculo.emergencyName : "no está unido a ninguna"}
                      </p>
                    </div>

                    <div className="mc-actions">
                      <Link
                        to={`/center/${center.center_id}/inventory`}
                        className="mc-btn mc-btn-primary"
                      >
                        Gestionar Inventario
                      </Link>
                      <Link
                        to={`/center/${center.center_id}/details`}
                        className="mc-btn mc-btn-secondary"
                      >
                        Ver Detalles
                      </Link>
                    </div>
                  </div>

                  {vinculo?.superEventName && (
                    <details className="mc-compartido">
                      <summary>
                        <span className="mc-compartido-texto">
                          Este centro se está compartiendo con otras comunas en{" "}
                          <strong>«{vinculo.superEventName}»</strong>
                        </span>
                      </summary>
                      <div className="mc-compartido-detalle">
                        <p>
                          Las comunas participantes ven su ubicación, capacidad, nivel de
                          abastecimiento y necesidades.
                        </p>
                        <p className="mc-compartido-nunca">
                          Nunca ven los datos de las personas alojadas.
                        </p>
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
