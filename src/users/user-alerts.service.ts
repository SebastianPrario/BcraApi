import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MailerService } from '@nestjs-modules/mailer';
import axios from 'axios';
import { UserCuit } from './entities/user-cuit.entity';
import { User } from './entities/user.entity';

@Injectable()
export class UserAlertsService {
  private readonly logger = new Logger(UserAlertsService.name);

  constructor(
    @InjectRepository(UserCuit)
    private userCuitRepository: Repository<UserCuit>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private mailerService: MailerService,
  ) {}

  @Cron(CronExpression.EVERY_WEEK)
  async handleCron() {
    this.logger.log('Starting weekly Registered User CUIT check...');
    const cuits = await this.userCuitRepository.find({ relations: ['user'] });

    // Group CUITS by user to send one summary email per user
    const usersToNotify = new Map<string, { user: User, changedCuits: any[] }>();

    for (const userCuit of cuits) {
      try {
        const financialStatus = await this.fetchFinancialStatus(userCuit.cuit);
        const rejectedChecks = await this.fetchRejectedChecks(userCuit.cuit);

        const financialChanged = this.hasFinancialStatusChanged(userCuit.lastFinancialStatus, financialStatus);
        const checksChanged = this.hasRejectedChecksChanged(userCuit.lastRejectedChecks, rejectedChecks);

        if (financialChanged || checksChanged) {
          userCuit.lastFinancialStatus = financialStatus;
          userCuit.lastRejectedChecks = rejectedChecks;
          userCuit.lastCheckedAt = new Date();
          await this.userCuitRepository.save(userCuit);

          if (!usersToNotify.has(userCuit.user.id)) {
            usersToNotify.set(userCuit.user.id, { user: userCuit.user, changedCuits: [] });
          }
          usersToNotify.get(userCuit.user.id)?.changedCuits.push({
            cuit: userCuit.cuit,
            financialStatus,
            rejectedChecks,
            financialChanged,
            checksChanged
          });
        }
      } catch (error) {
        this.logger.error(`Error checking CUIT ${userCuit.cuit} for user ${userCuit.user.email}: ${error.message}`);
      }
    }

    for (const [userId, data] of usersToNotify) {
      await this.sendBulkAlertEmail(data.user, data.changedCuits);
    }
  }

  private async fetchFinancialStatus(cuit: string) {
    try {
      const cuitLimpio = cuit.replace(/[-\s]/g, "");
      const response = await axios.get(`https://api.bcra.gob.ar/CentralDeDeudores/V1.0/Deudas/${cuitLimpio}`);
      return response.data;
    } catch (error) {
      this.logger.error(`BCRA Deudas API error for CUIT ${cuit}: ${error.message}`);
      return null;
    }
  }

  private async fetchRejectedChecks(cuit: string) {
    try {
      const cuitLimpio = cuit.replace(/[-\s]/g, "");
      const response = await axios.get(`https://api.bcra.gob.ar/CentralDeDeudores/V1.0/Deudas/ChequesRechazados/${cuitLimpio}`);
      return response.data;
    } catch (error) {
      this.logger.error(`BCRA ChequesRechazados API error for CUIT ${cuit}: ${error.message}`);
      return null;
    }
  }

  private hasFinancialStatusChanged(oldStatus: any, newStatus: any): boolean {
    if (!newStatus) return false;
    if (!oldStatus) return true;
    
    const normalize = (res: any) => {
      const entities = res?.results?.periodos?.[0]?.entidades || [];
      return entities.map(e => ({
        entidad: e.entidad,
        situacion: e.situacion,
        monto: e.monto
      })).sort((a, b) => a.entidad.localeCompare(b.entidad));
    };

    return JSON.stringify(normalize(oldStatus)) !== JSON.stringify(normalize(newStatus));
  }

  private hasRejectedChecksChanged(oldChecks: any, newChecks: any): boolean {
    if (!newChecks) return false;
    if (!oldChecks) return true;

    const normalize = (res: any) => {
      const causales = res?.results?.causales || [];
      return causales.map(c => ({
        causal: c.causal,
        checksCount: c.entidades?.reduce((acc, ent) => acc + (ent.detalle?.length || 0), 0) || 0
      })).sort((a, b) => a.causal.localeCompare(b.causal));
    };

    return JSON.stringify(normalize(oldChecks)) !== JSON.stringify(normalize(newChecks));
  }

  private async sendBulkAlertEmail(user: User, changedCuits: any[]) {
    const cuitBlocks = changedCuits.map(item => {
      const financialHtml = item.financialStatus?.results?.periodos?.[0]?.entidades?.map(ent => `
        <li style="margin-bottom: 5px;">${ent.entidad}: Situación ${ent.situacion} ($${ent.monto * 1000})</li>
      `).join('') || 'Sin datos de deudas.';

      const checksHtml = item.rejectedChecks?.results?.causales?.map(c => `
        <li style="margin-bottom: 5px;">${c.causal}: ${c.entidades?.length || 0} entidades afectadas</li>
      `).join('') || 'Sin cheques rechazados.';

      return `
        <div style="margin-bottom: 30px; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px;">
          <h3 style="color: #4f46e5; margin-top: 0;">CUIT: ${item.cuit}</h3>
          <p><strong>Situación Financiera:</strong> ${item.financialChanged ? '<span style="color: red;">(CAMBIO)</span>' : ''}</p>
          <ul>${financialHtml}</ul>
          <p><strong>Cheques Rechazados:</strong> ${item.checksChanged ? '<span style="color: red;">(CAMBIO)</span>' : ''}</p>
          <ul>${checksHtml}</ul>
        </div>
      `;
    }).join('');

    const html = `
      <div style="font-family: Arial, sans-serif; color: #334155; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #6366f1;">Actualización de Monitoreo BCRA</h2>
        <p>Hola ${user.name}, se han detectado cambios en los siguientes CUITs bajo tu seguimiento:</p>
        ${cuitBlocks}
        <p style="font-size: 12px; color: #64748b; margin-top: 40px;">
          Este es un aviso automático de ChequesRechazados.com.ar
        </p>
      </div>
    `;

    await this.mailerService.sendMail({
      to: user.email,
      subject: `Alerta BCRA: Cambios detectados en tus CUITs`,
      html: html,
    });
  }
}
