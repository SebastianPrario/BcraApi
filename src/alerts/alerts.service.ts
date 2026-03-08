import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MailerService } from '@nestjs-modules/mailer';
import axios from 'axios';
import { Alert } from './entities/alert.entity';
import { SubscribeDto } from './dto/subscribe.dto';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(Alert)
    private alertRepository: Repository<Alert>,
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

  @Cron(CronExpression.EVERY_WEEK)
  async handleCron() {
    this.logger.log('Starting weekly CUIT status check...');
    const alerts = await this.alertRepository.find();
   
    for (const alert of alerts) {
      try {
        const currentStatus = await this.fetchBCRAStatus(alert.cuit);
        if (this.hasStatusChanged(alert.lastStatus, currentStatus)) {
          
          this.logger.log(`Status changed for ${alert.email} / CUIT ${alert.cuit}`);
          await this.sendAlertEmail(alert.email, alert.cuit, currentStatus, alert.id);
          
          alert.lastStatus = currentStatus;
          alert.lastCheckedAt = new Date();
          await this.alertRepository.save(alert);
        }
      } catch (error) {
        this.logger.error(`Error checking alert for ${alert.email}: ${error.message}`);
      }
    }
  }

  private async fetchBCRAStatus(cuit: any) {
    try {
      const cuitStr = String(cuit);
      const cuitLimpio = cuitStr.replace(/[-\s]/g, "");
      const response = await axios.get(`https://api.bcra.gob.ar/CentralDeDeudores/V1.0/Deudas/${cuitLimpio}`);
      
      const results = response.data.results;
      if (!results || !results.periodos || results.periodos.length === 0) {
        return null;
      }

      return {
        denominacion: results.denominacion,
        entidades: results.periodos[0].entidades
      };
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger.warn(`CUIT ${cuit} not found in BCRA API`);
        return null;
      }
      this.logger.error(`BCRA API error for CUIT ${cuit}: ${error.message}`);
      throw error;
    }
  }

  private hasStatusChanged(oldStatus: any, newStatus: any): boolean {
    if (!oldStatus || !newStatus) return false;
    
    // Normalizamos y ordenamos para una comparación robusta
    const normalize = (entities: any[]) => {
      return [...entities]
        .map(e => ({
          entidad: e.entidad,
          situacion: Number(e.situacion),
          monto: Number(e.monto)
        }))
        .sort((a, b) => a.entidad.localeCompare(b.entidad));
    };
    
    const oldEntities = normalize(Array.isArray(oldStatus) ? oldStatus : (oldStatus.entidades || []));
    const newEntities = normalize(newStatus.entidades || []);
  
    return JSON.stringify(oldEntities) !== JSON.stringify(newEntities);
  }

  private async sendAlertEmail(email: string, cuit: string, status: any, alertId: string) {
    const unsubscribeUrl = `${process.env.THIS_APP_URL}/alerts/unsubscribe/${alertId}`; // Should be config driven
    
    // Simplistic HTML template replicating the front's feel
    const entitiesHtml = status.entidades?.map((ent: any) => `
      <div style="border-bottom: 1px solid #e2e8f0; padding: 10px 0;">
        <strong>${ent.entidad}</strong><br>
        Situación: <span style="color: ${ent.situacion > 1 ? '#ef4444' : '#10b981'}">${ent.situacion}</span> | 
        Monto: $${ent.monto*1000}
      </div>
    `).join('') || '<p>No hay datos de entidades disponibles.</p>';

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
            <p>Se ha detectado un cambio en la situación crediticia para <strong>${status.denominacion || 'Cuit ' + cuit}</strong>.</p>
            
            <div style="background: #f1f5f9; border-radius: 12px; padding: 20px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #4f46e5;">Resumen de Entidades</h3>
              ${entitiesHtml}
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
