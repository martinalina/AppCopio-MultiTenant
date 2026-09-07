// src/services/tokenCleanupService.ts
import pool from "../config/db";

/**
 * Limpia tokens expirados y revocados de la base de datos
 * Se recomienda ejecutar periódicamente (ej: cada hora o diariamente)
 */
export async function cleanupExpiredTokens(): Promise<void> {
  try {
    // console.log('[TokenCleanup] 🧹 Iniciando limpieza de tokens expirados...');
    
    // RefreshTokens está sellada con RLS sin políticas permisivas: el criterio de
    // purga vive dentro de la función SECURITY DEFINER, que es la única vía de acceso.
    const result = await pool.query(`SELECT refresh_token_purge() AS deleted`);
    
    const deletedCount = Number(result.rows[0]?.deleted ?? 0);
    
    if (deletedCount > 0) {
      // console.log(`[TokenCleanup] ✅ Eliminados ${deletedCount} tokens obsoletos`);
    } else {
      // console.log('[TokenCleanup] ℹ️ No hay tokens para limpiar');
    }
    
  } catch (error) {
    console.error('[TokenCleanup] ❌ Error al limpiar tokens:', error);
  }
}

/**
 * Inicia la limpieza automática periódica de tokens
 * @param intervalHours - Intervalo en horas entre limpiezas (default: 6 horas)
 */
export function startTokenCleanupScheduler(intervalHours: number = 6): NodeJS.Timeout {
  // console.log(`[TokenCleanup] 🕐 Programando limpieza automática cada ${intervalHours} horas`);
  
  // Ejecutar inmediatamente al iniciar
  cleanupExpiredTokens();
  
  // Programar ejecuciones periódicas
  const intervalMs = intervalHours * 60 * 60 * 1000;
  return setInterval(cleanupExpiredTokens, intervalMs);
}

/**
 * Revoca todos los tokens de un usuario específico
 * Útil para forzar cierre de sesión en todos los dispositivos
 */
export async function revokeAllUserTokens(userId: number): Promise<void> {
  try {
    // console.log(`[TokenCleanup] 🔒 Revocando todos los tokens del usuario ${userId}...`);
    
    const result = await pool.query(`SELECT refresh_token_revoke_all($1) AS revoked`, [userId]);
    
    const revokedCount = Number(result.rows[0]?.revoked ?? 0);
    // console.log(`[TokenCleanup] ✅ Revocados ${revokedCount} tokens del usuario ${userId}`);
    
  } catch (error) {
    console.error(`[TokenCleanup] ❌ Error al revocar tokens del usuario ${userId}:`, error);
    throw error;
  }
}

/**
 * Obtiene estadísticas de tokens en la base de datos
 */
export async function getTokenStats(): Promise<{
  total: number;
  active: number;
  expired: number;
  revoked: number;
}> {
  try {
    const result = await pool.query(`SELECT * FROM refresh_token_stats()`);
    
    return {
      total: parseInt(result.rows[0].total),
      active: parseInt(result.rows[0].active),
      expired: parseInt(result.rows[0].expired),
      revoked: parseInt(result.rows[0].revoked)
    };
  } catch (error) {
    console.error('[TokenCleanup] ❌ Error al obtener estadísticas:', error);
    return { total: 0, active: 0, expired: 0, revoked: 0 };
  }
}
