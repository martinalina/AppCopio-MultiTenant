// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import listEndpoints from "express-list-endpoints";


import pool from "./config/db";
import authRoutes from "./routes/authRoutes";
import centerRoutes from "./routes/centerRoutes";
import productRoutes from "./routes/productRoutes";
import inventoryRoutes from "./routes/inventoryRoutes";
import userRouter from "./routes/userRoutes";
import updateRoutes from "./routes/updateRoutes";
import categoryRoutes from "./routes/categoryRoutes";
import assignmentRoutes from "./routes/assignmentRoutes";
import personsRoutes from "./routes/personsRoutes";
import familyRoutes from "./routes/familyRoutes";
import familyMembersRoutes from "./routes/familyMembersRoutes";
import fibeRoutes from "./routes/fibeRoutes";
import roleRoutes from "./routes/roleRoutes";
import zoneRoutes from "./routes/zoneRoutes";
import shiftRoutes from "./routes/shiftRoutes";
import {requireAuth} from "./auth/middleware";
import { withTenant } from "./auth/tenantContext";
import municipalityRoutes from "./routes/municipalityRoutes";
import emergencyRoutes from "./routes/emergencyRoutes";
import superEventRoutes from "./routes/superEventRoutes";
import crossSupportRoutes from "./routes/crossSupportRoutes";
import csvRoutes from "./routes/csvRoutes";

import databaseRoutes from "./routes/databaseRoutes";
import fieldRoutes from "./routes/fieldRoutes";
import recordRoutes from "./routes/recordRoutes";
import templateRoutes from "./routes/templateRoutes";
import auditLogRoutes from "./routes/auditLogRoutes";
import notificationRoutes from "./routes/notificacionRoutes";
import migrateRoutes from "./routes/migrate";
import prioritiesRoutes from "./routes/prioritiesRoutes"; 
import volunteerRoutes from './routes/volunteerContactRoutes';
import serviceRequestRoutes from "./routes/serviceRequestRoutes";
import movementRoutes from "./routes/movementRoutes";
import resourceBoxRoutes from "./routes/resourceBoxRoutes";
import { startShiftStatusJob } from "./jobs/shiftStatusJob";
import { startTokenCleanupScheduler } from "./services/tokenCleanupService";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.set("trust proxy", 1);


app.use(express.json());
app.use(cookieParser());


/** Orígenes permitidos */
const allowedOrigins = [
  "http://localhost:5173",
  "https://appcopio.vercel.app",
];

const corsOptions: cors.CorsOptions = {
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

/** CORS antes de las rutas */
app.use((req, res, next) => {
  res.header("Vary", "Origin");
  next();
});
app.use(cors(corsOptions));

/** Rate limit solo en auth */
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use("/api/auth", limiter);
app.use("/api/auth", authRoutes);

/** Rutas */
app.get("/api", (req: Request, res: Response) => {
  res.json({ message: "¡El Backend de AppCopio está funcionando! 災害" });
});

// Endpoint de ping para monitoreo de conectividad (sin autenticación)
// Este endpoint es ultra-ligero para detectar rápidamente si hay conexión
app.head("/api/ping", (_req: Request, res: Response) => {
  res.status(200).end();
});

app.get("/api/ping", (_req: Request, res: Response) => {
  res.status(200).json({ 
    status: "ok", 
    timestamp: Date.now() 
  });
});

// Regla general: toda ruta con requireAuth lleva withTenant justo después, para que
// las consultas corran dentro de una transacción con app.current_tenant seteado.
//
// Los routers que MEZCLAN endpoints públicos y privados bajo el mismo prefijo
// (centerRoutes, prioritiesRoutes, volunteerRoutes, serviceRequestRoutes) NO reciben
// middleware acá: lo aplican por ruta en su propio archivo. Montar withPublicContext
// a nivel de prefijo haría que app.public_access quedara activo también en requests
// autenticadas y, como las políticas permisivas se combinan con OR, un admin podría
// leer los centros activos de otras comunas.
app.use("/api/centers", centerRoutes);
app.use("/api/products", requireAuth, withTenant, productRoutes);
app.use("/api/updates", requireAuth, withTenant, updateRoutes);
app.use("/api/users", requireAuth, withTenant, userRouter);
app.use("/api/inventory", requireAuth, withTenant, inventoryRoutes);
app.use("/api/categories", requireAuth, withTenant, categoryRoutes); // antes no tenía NINGÚN requireAuth
app.use("/api/assignments", requireAuth, withTenant, assignmentRoutes);
app.use("/api/persons", requireAuth, withTenant, personsRoutes);
app.use("/api/family", requireAuth, withTenant, familyRoutes);
app.use("/api/family-members", requireAuth, withTenant, familyMembersRoutes);
app.use("/api/fibe", requireAuth, withTenant, fibeRoutes);
app.use("/api/roles", requireAuth, withTenant, roleRoutes);
app.use("/api/csv/upload", requireAuth, withTenant, csvRoutes);
app.use("/api/zones", requireAuth, withTenant, zoneRoutes);
app.use("/api/shifts", requireAuth, withTenant, shiftRoutes);
app.use("/api/database", requireAuth, withTenant, databaseRoutes);
app.use("/api/database-fields", requireAuth, withTenant, fieldRoutes);
app.use("/api/database-records", requireAuth, withTenant, recordRoutes);
app.use("/api/database-templates", requireAuth, withTenant, templateRoutes);
app.use("/api/database-history", requireAuth, withTenant, auditLogRoutes);
app.use("/api/notifications", requireAuth, withTenant, notificationRoutes);
app.use("/api/migrate", requireAuth, withTenant, migrateRoutes); // el handler además exige superadmin
app.use("/api/resource-boxes", requireAuth, withTenant, resourceBoxRoutes);
app.use("/api/centers", prioritiesRoutes);
app.use("/api/centers", requireAuth, withTenant, movementRoutes);
app.use('/api/volunteers', volunteerRoutes);
app.use('/api/service-request', serviceRequestRoutes);
app.use('/api/municipalities', requireAuth, withTenant, municipalityRoutes); // solo Super Administrador
app.use('/api/emergencies', requireAuth, withTenant, emergencyRoutes);   // emergencias LOCALES de una comuna
app.use('/api/super-events', requireAuth, withTenant, superEventRoutes); // colaboración intermunicipal
app.use('/api/cross-support', requireAuth, withTenant, crossSupportRoutes);

/** Middleware de errores (último siempre) */
app.use((err: any, req: Request, res: Response, next: NextFunction): void => {
  if (err?.message === "Not allowed by CORS") {
    res.status(403).json({ error: "Origen no permitido por CORS" });
    return;
  }
  // requireUser/requireSuperAdmin/requireTenant/requireCenterManager lanzan errores
  // con .status (401/403) y a veces .publicMessage. Sin esto, un permiso denegado
  // llegaría al cliente como un 500 genérico.
  if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: err.message, message: err.publicMessage });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
  pool.query("SELECT NOW()", (err, resQuery) => {
    if (err) {
      console.error("Error al conectar con la BD al iniciar:", err);
    }
  });
  
  // Iniciar el cron job de actualización de estados de turnos
  startShiftStatusJob();
  console.log('✅ Cron job de turnos iniciado');
  
  // Iniciar limpieza automática de tokens cada 6 horas
  startTokenCleanupScheduler(6);
  console.log('✅ Limpieza automática de tokens iniciada');

    
});

app.get("/__routes", (_req, res) => {
  res.json(listEndpoints(app));
});