import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MailerService } from '@nestjs-modules/mailer';
import axios from 'axios';
import * as https from 'https';
import { Alert } from './entities/alert.entity';
import { SubscribeDto } from './dto/subscribe.dto';
import { UserCuit } from '../users/entities/user-cuit.entity';

@Injectable()
export class AlertsService  {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(Alert)
    private alertRepository: Repository<Alert>,
    @InjectRepository(UserCuit)
    private userCuitRepository: Repository<UserCuit>,
    private mailerService: MailerService,
  ) {}

  async subscribe(subscribeDto: SubscribeDto) {
    const { email, cuit } = subscribeDto;
    const existingAlert = await this.alertRepository.findOne({ where: { email } });
    if (existingAlert) {
      if (existingAlert.cuit !== cuit) {
        throw new ConflictException('Este correo electrónico ya está registrado con un CUIT diferente.');
      }
      
      // If CUIT is the same, just refresh the data
      existingAlert.lastCheckedAt = new Date();
      existingAlert.lastStatus = await this.fetchBCRAStatus(cuit);
      return this.alertRepository.save(existingAlert);
    }

    const initialStatus = await this.fetchBCRAStatus(cuit);
    
    if (initialStatus === null) {
      throw new ConflictException('No se encontró información para este CUIT en el BCRA. Por favor, verifique el número.');
    }

    const newAlert = this.alertRepository.create({
      email,
      cuit,
      lastStatus: initialStatus,
      lastCheckedAt: new Date(),
    });

     return this.alertRepository.save(newAlert);
  }

  async unsubscribe(id: string) {
    const result = await this.alertRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Alert with ID ${id} not found`);
    }
    return { message: 'Unsubscribed successfully' };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.log('Starting uniffied BCRA status check...');
    
    await new Promise(res => setTimeout(res, 5000));
    
    const alerts = await this.alertRepository.find();
    const userCuits = await this.userCuitRepository.find({ relations: ['user'] });
   
    const itemsToCheck = [
      ...alerts.map(a => ({ type: 'alert', entity: a, cuit: a.cuit, email: a.email, lastStatus: a.lastStatus, id: a.id, user: null })),
      ...userCuits.map(uc => ({ type: 'userCuit', entity: uc, cuit: uc.cuit, email: uc.user.email, lastStatus: uc.lastFinancialStatus, id: uc.id, user: uc.user }))
    ];
    
    const itemsByCuit = itemsToCheck.reduce((acc, item) => {
      if (!acc[item.cuit]) acc[item.cuit] = [];
      acc[item.cuit].push(item);
      return acc;
    }, {} as Record<string, typeof itemsToCheck>);

    const notificationsByEmail = new Map<string, { email: string, user: any, changes: any[] }>();

    for (const [cuit, items] of Object.entries(itemsByCuit)) {
      try {
        const currentStatus = await this.fetchBCRAStatus(cuit);
        
        // PROTECTION: If network fails (null), skip this CUIT completely
        if (!currentStatus) {
          this.logger.warn(`Skipping CUIT ${cuit} due to API failure. Data remained unchanged in DB.`);
          continue;
        }

        for (const item of items) {
          const hasChanged = this.hasStatusChanged(item.lastStatus, currentStatus);
          
          if (hasChanged) {
            this.logger.log(`Change detected for CUIT ${cuit} (${item.email})`);
            
            // Collect for notification only if there was a previous status
            if (item.lastStatus) {
              const emailKey = item.user ? item.user.id : item.email;
              let notification = notificationsByEmail.get(emailKey);
              if (!notification) {
                notification = { email: item.email, user: item.user, changes: [] };
                notificationsByEmail.set(emailKey, notification);
              }
              notification.changes.push({ cuit, status: currentStatus });
            }

            // Persistence
            if (item.type === 'alert') {
              const alert = item.entity as Alert;
              alert.lastStatus = currentStatus;
              alert.lastCheckedAt = new Date();
              await this.alertRepository.save(alert);
            } else {
              const userCuit = item.entity as UserCuit;
              userCuit.lastFinancialStatus = currentStatus;
              userCuit.lastCheckedAt = new Date();
              await this.userCuitRepository.save(userCuit);
            }
          }
        }
      } catch (error) {
        this.logger.error(`Error in CUIT cycle ${cuit}: ${error.message}`);
      }
      
      await new Promise(res => setTimeout(res, 10000));
    }

    // Send summary emails
    for (const [key, data] of notificationsByEmail) {
      try {
        await this.sendBulkAlertEmail(data.email, data.user, data.changes);
        this.logger.log(`Summary email sent to ${data.email}`);
      } catch (e) {
        this.logger.error(`Failed to send summary email to ${data.email}: ${e.message}`);
      }
    }
  }

  private async fetchBCRAStatus(cuit: any, retries = 5): Promise<any> {
    const cuitStr = String(cuit);
    const cuitLimpio = cuitStr.replace(/[-\s]/g, "");
    
    // Agente HTTPS para mejorar la persistencia de conexión en Node.js
    const httpsAgent = new https.Agent({
      keepAlive: true,
      timeout: 15000,
    });

    const config = {
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      timeout: 15000, // Aumentamos timeout a 15s
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        let result: any = { entidades: [], chequesRechazados: [] };
        let status404Count = 0;

        // Pequeño delay inicial por reintento
        if (attempt > 1) await new Promise(res => setTimeout(res, attempt * 3000));

        // Consulta de Deudas
        try {
          const response = await axios.get(`https://api.bcra.gob.ar/CentralDeDeudores/V1.0/Deudas/${cuitLimpio}`, config);
          const results = response.data.results;
          if (results && results.periodos && results.periodos.length > 0) {
            result.denominacion = results.denominacion;
            result.entidades = results.periodos[0].entidades;
          }
        } catch (error) {
          if (error.response?.status === 404) {
             status404Count++;
          } else {
             throw error; // Relanza para el catch del loop de reintentos
          }
        }

        // Consulta de Cheques Rechazados
        try {
          const response = await axios.get(`https://api.bcra.gob.ar/CentralDeDeudores/V1.0/Deudas/ChequesRechazados/${cuitLimpio}`, config);
          const results = response.data.results;
          if (results && results.causales && results.causales.length > 0) {
            result.denominacion = result.denominacion || results.denominacion;
            result.chequesRechazados = results.causales;
          }
        } catch (error) {
          if (error.response?.status === 404) {
             status404Count++;
          } else {
             throw error; // Relanza para el catch del loop de reintentos
          }
        }

        if (status404Count === 2) {
          this.logger.warn(`CUIT ${cuit} not found in BCRA API after status checks`);
          return null;
        }

        if (!result.denominacion && result.entidades.length === 0 && result.chequesRechazados.length === 0) {
            if (status404Count > 0) return null;
        }

        return result;
      } catch (error) {
        const isTransient = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.response?.status === 429;
        
        if (isTransient && attempt < retries) {
          this.logger.warn(`BCRA API transient error (${error.code || error.response?.status}) for CUIT ${cuitLimpio}. Retrying in ${attempt * 5}s... (Attempt ${attempt}/${retries})`);
          await new Promise(res => setTimeout(res, attempt * 5000));
          continue;
        }
        
        this.logger.error(`BCRA API fatal error for CUIT ${cuit} after ${attempt} attempts: ${error.message}`);
        // No lanzamos error para no romper el ciclo handleCron, simplemente devolvemos null
        return null;
      }
    }
  }

  private hasStatusChanged(oldStatus: any, newStatus: any): boolean {
    if (!newStatus) return false;
    if (!oldStatus) return true;

    // Normalización de Entidades Financieras (Deudas)
    const normalizeEntidades = (entities: any[]) => {
      return [...(entities || [])]
        .map(e => ({
          entidad: String(e.entidad || '').trim().toUpperCase(),
          situacion: Number(e.situacion || 0),
          monto: Math.round(Number(e.monto || 0)) // Redondeamos para evitar diferencias por decimales insignificantes
        }))
        .sort((a, b) => a.entidad.localeCompare(b.entidad));
    };
    
    // Normalización de Cheques Rechazados (Estructura compleja)
    const normalizeCheques = (causales: any[]) => {
      return [...(causales || [])]
        .map(c => ({
          causal: String(c.causal || '').trim().toUpperCase(),
          entidades: [...(c.entidades || [])]
            .map(e => ({
              entidad: Number(e.entidad || 0),
              detalle: [...(e.detalle || [])]
                .map(d => ({
                  nroCheque: Number(d.nroCheque || 0),
                  monto: Math.round(Number(d.monto || 0)),
                  fechaRechazo: String(d.fechaRechazo || '')
                }))
                .sort((a, b) => a.nroCheque - b.nroCheque || a.monto - b.monto)
            }))
            .sort((a, b) => a.entidad - b.entidad)
        }))
        .sort((a, b) => a.causal.localeCompare(b.causal));
    };

    const oldEntities = normalizeEntidades(Array.isArray(oldStatus) ? oldStatus : (oldStatus.entidades || []));
    const newEntities = normalizeEntidades(newStatus.entidades || []);

    const oldCheques = normalizeCheques(oldStatus.chequesRechazados || []);
    const newCheques = normalizeCheques(newStatus.chequesRechazados || []);
    
    const sOldEntities = JSON.stringify(oldEntities);
    const sNewEntities = JSON.stringify(newEntities);
    const sOldCheques = JSON.stringify(oldCheques);
    const sNewCheques = JSON.stringify(newCheques);

    const entitiesDiff = sOldEntities !== sNewEntities;
    const chequesDiff = sOldCheques !== sNewCheques;

    if (entitiesDiff || chequesDiff) {
      this.logger.debug(`Difference detected for CUIT. EntitiesDiff=${entitiesDiff}, ChequesDiff=${chequesDiff}`);
      if (entitiesDiff) {
        this.logger.debug(`Old Entities Sumary: ${sOldEntities.substring(0, 100)}...`);
          this.logger.debug(`New Entities Sumary: ${sNewEntities.substring(0, 100)}...`);
      }
      return true;
    }
  
    return false;
  }

  private async sendBulkAlertEmail(email: string, user: any, changes: any[]) {
    const userName = user ? user.name : 'Usuario';
    const cuitBlocks = changes.map(item => {
      const status = item.status;
      
      const entitiesHtml = status.entidades?.length > 0 ? status.entidades.map((ent: any) => `
        <div style="padding: 10px; background: #f8fafc; border-radius: 8px; margin-bottom: 8px; border-left: 4px solid ${ent.situacion > 1 ? '#ef4444' : '#10b981'};">
          <strong>${ent.entidad}</strong>: Situación ${ent.situacion} | $${ent.monto * 1000}
        </div>
      `).join('') : '<p>Sin deudas reportadas.</p>';

      let chequesHtml = '';
      if (status.chequesRechazados?.length > 0) {
        chequesHtml = status.chequesRechazados.map((causal: any) => `
          <div style="margin-top: 10px; padding: 10px; background: #fff5f5; border-radius: 8px; border: 1px solid #feb2b2;">
            <div style="font-weight: bold; color: #c53030; margin-bottom: 5px;">${causal.causal}</div>
            ${causal.entidades?.map((e: any) => e.detalle?.length || 0).reduce((a, b) => a + b, 0)} cheques detectados.
          </div>
        `).join('');
      } else {
        chequesHtml = '<p style="color: #718096; font-size: 13px;">Sin cheques rechazados.</p>';
      }

      return `
        <div style="margin-bottom: 25px; border: 1px solid #e2e8f0; padding: 20px; border-radius: 12px; background: #ffffff;">
          <h3 style="color: #4f46e5; margin: 0 0 15px 0; border-bottom: 1px solid #edf2f7; padding-bottom: 10px;">CUIT: ${item.cuit}</h3>
          <h4 style="font-size: 14px; text-transform: uppercase; color: #64748b; margin-bottom: 10px;">Situación Financiera</h4>
          ${entitiesHtml}
          <h4 style="font-size: 14px; text-transform: uppercase; color: #64748b; margin: 15px 0 10px 0;">Cheques</h4>
          ${chequesHtml}
        </div>
      `;
    }).join('');

    const html = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #2d3748; background: #f7fafc; padding: 40px 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 20px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); overflow: hidden;">
          <div style="background: #4f46e5; padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Resumen de Alertas BCRA</h1>
            <p style="color: #c7d2fe; margin-top: 5px;">Se detectaron ${changes.length} cambios importantes</p>
          </div>
          <div style="padding: 30px;">
            <p style="font-size: 16px;">Hola <strong>${userName}</strong>,</p>
            <p>Nuestro sistema de monitoreo ha detectado actualizaciones en los siguientes CUITs:</p>
            <div style="margin-top: 25px;">
              ${cuitBlocks}
            </div>
            <div style="text-align: center; margin-top: 30px;">
              <a href="${process.env.FRONTEND_URL || 'https://chequesrechazados.com.ar'}" 
                 style="display: inline-block; background: #4f46e5; color: white; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: bold;">
                 Ver Panel de Control
              </a>
            </div>
            <p style="font-size: 12px; color: #a0aec0; text-align: center; margin-top: 40px;">
              Has recibido este email porque monitoreas estos CUITs en ChequesRechazados.com.ar
            </p>
          </div>
        </div>
      </div>
    `;

    await this.mailerService.sendMail({
      to: email,
      subject: `[ALERTA] Resumen de cambios BCRA (${changes.length} CUITs)`,
      html,
    });
  }

  private async sendAlertEmail(email: string, cuit: string, status: any, alertId: string) {
    this.logger.log(`Preparing to send email to ${email} for CUIT ${cuit}`);
    const unsubscribeUrl = `${process.env.THIS_APP_URL}/alerts/unsubscribe/${alertId}`; // Should be config driven
    
    const entitiesHtml = status.entidades?.length > 0 ? status.entidades.map((ent: any) => `
      <div style="padding: 12px; background: #f8fafc; border-radius: 10px; margin-bottom: 10px; border-left: 5px solid ${ent.situacion > 1 ? '#ef4444' : '#10b981'};">
        <strong>${ent.entidad}</strong><br>
        Situación: <span style="color: ${ent.situacion > 1 ? '#ef4444' : '#10b981'}">${ent.situacion}</span> | 
        Monto: $${ent.monto*1000}
      </div>
    `).join('') : '<p>No hay deudas registradas.</p>';

    let chequesHtml = '';
    if (status.chequesRechazados?.length > 0) {
      chequesHtml = `
        <h3 style="margin-top: 20px; color: #4f46e5;">Cheques Rechazados</h3>
      `;
      status.chequesRechazados.forEach((causal: any) => {
        chequesHtml += `<div style="margin-bottom: 15px;">`;
        chequesHtml += `<div style="margin-bottom: 8px; font-weight: bold; color: #dc2626; font-size: 15px;">Causal: ${causal.causal}</div>`;
        causal.entidades?.forEach((entidadObj: any) => {
          entidadObj.detalle?.forEach((detalle: any) => {
            chequesHtml += `
            <div style="border-bottom: 1px solid #e2e8f0; padding: 10px 0; font-size: 14px; background-color: #fef2f2; border-radius: 6px; padding: 12px; margin-bottom: 8px;">
              <strong style="color: #991b1b;">Cheque Nº ${detalle.nroCheque}</strong><br>
              <div style="margin-top: 5px;">
                <span style="color: #475569;">Fecha Rechazo:</span> ${detalle.fechaRechazo} | 
                <span style="color: #475569;">Monto:</span> <strong>$${detalle.monto.toLocaleString()}</strong><br>
                <span style="color: #475569;">Estado Multa:</span> ${detalle.estadoMulta} | 
                <span style="color: #475569;">Entidad:</span> ${detalle.denomJuridica || entidadObj.entidad || 'N/A'}
              </div>
            </div>
            `;
          });
        });
        chequesHtml += `</div>`;
      });
    }

    const html = `
      <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7fa; padding: 40px 20px; color: #334155;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
          <div style="background-color: #ffffff; padding: 20px; text-align: center; border-bottom: 2px solid #f1f5f9;">
            <a href="https://chequesrechazados.com.ar" style="text-decoration: none; color: #4f46e5; font-weight: 800; font-size: 20px; letter-spacing: -0.5px;">
               <span style="color: #6366f1;">ChequesRechazados.com.ar</span>
            </a>
          </div>
          
          <div style=" padding: 10px; color: #ffffff; text-align: center;">
            <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #000000ff;">Cambio de Situación Detectado</h1>
            <p style="margin-top: 8px; opacity: 0.9; font-size: 14px; color: #000000ff;">Monitoreo Automático de CUIT</p>
          </div>
          <div style="padding: 10px;">
            <p>Hola,</p>
            <p>Se ha detectado un cambio en la situación crediticia o de cheques para <strong>${status.denominacion || 'Cuit ' + cuit}</strong>.</p>
            
            <div style="background: #f1f5f9; border-radius: 12px; padding: 20px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #4f46e5;">Situación Crediticia</h3>
              ${entitiesHtml}
              ${chequesHtml}
              <p style="margin-top: 15px; font-size: 13px; color: #64748b;">
                Última verificación: ${new Date().toLocaleString()}
              </p>
            </div>

            <div style="text-align: center; margin-top: 30px;">
              <a href="https://chequesrechazados.com.ar" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 10px; font-weight: bold;">Ver Informe Completo</a>
            </div>
            
            <hr style="margin: 40px 0; border: 0; border-top: 1px solid #e2e8f0;">
            
            <p style="font-size: 12px; color: #64748b; text-align: center;">
              Si ya no deseas recibir estas alertas, puedes <a href="${unsubscribeUrl}" style="color: #6366f1;">darte de baja aquí</a>.
            </p>
          </div>
        </div>
      </div>
    `;

    await this.mailerService.sendMail({
      to: email,
      subject: `Alerta BCRA: Cambio en CUIT ${cuit}`,
      html: html,
    });
  }
}
