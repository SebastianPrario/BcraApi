import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import * as https from 'https';

@Injectable()
export class BcraService {
  private readonly logger = new Logger(BcraService.name);

  // Usamos un agente HTTPS con keepAlive desactivado y timeout de socket.
  private httpsAgent = new https.Agent({ 
    keepAlive: false,
    timeout: 30000 
  });

  async fetchWithRetry(url: string, retries = 2, delay = 150): Promise<any> {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await axios.get(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept-Encoding': 'identity',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
          httpsAgent: this.httpsAgent,
          timeout: 30000,
        });
        
        return response;
      } catch (err: any) {
        const isRetryable =
          !err.response || 
          err.code === 'ECONNRESET' ||
          err.code === 'ECONNABORTED' ||
          err.code === 'ETIMEDOUT' ||
          err.message?.includes('socket hang up') ||
          err.response?.status >= 500; // También reintentamos si el server da 5xx

        if (i === retries || !isRetryable) {
          this.logger.error(`Fallo definitivo en ${url} tras ${i} reintentos: ${err.message}`);
          throw err;
        }

        this.logger.warn(
          `Intento ${i + 1} fallido (${err.code || 'HTTP ' + err.response?.status}). Reintentando en ${delay}ms...`,
        );
        
        await new Promise((resolve) => setTimeout(resolve, delay));
        // Backoff más agresivo: duplicamos el tiempo de espera en cada fallo
        delay *= 2;
      }
    }
  }

  async fetchBCRAStatus(cuit: any) {
    try {
      const cuitLimpio = String(cuit).replace(/[-\s]/g, '');
      const response = await this.fetchWithRetry(
        `${process.env.API_URL_ENTIDADES}${cuitLimpio}`,
      );

      if (!response || !response.data || !response.data.results || !response.data.results.periodos || response.data.results.periodos.length === 0) {
        return null;
      }

      return response.data.results;
    } catch (error: any) {
      if (error.response?.status === 404) return null;
      
      // En lugar de "romper" con un 500 genérico, lanzamos una excepción controlada
      throw new ServiceUnavailableException({
        message: 'El servidor del BCRA no responde tras varios intentos.',
        error: 'BCRA_OFFLINE',
        detail: error.message
      });
    }
  }

  async fetchBCRACheques(cuit: any) {
    try {
      const cuitLimpio = String(cuit).replace(/[-\s]/g, '');
      const response = await this.fetchWithRetry(
        `${process.env.API_URL_CHEQUESRECHAZADOS}${cuitLimpio}`,
      );

      if (!response || !response.data || !response.data.results) return null;
      return response.data.results;
    } catch (error: any) {
      if (error.response?.status === 404) return null;
      
      throw new ServiceUnavailableException({
        message: 'No se pudo obtener información de cheques del BCRA.',
        error: 'BCRA_CHEQUES_OFFLINE',
        detail: error.message
      });
    }
  }

  hasStatusChanged(oldStatus: any, newStatus: any): boolean {
    if (!oldStatus || !newStatus) return false;

    const normalize = (entities: any[]) => {
      return [...entities]
        .map((e) => ({
          entidad: e.entidad,
          situacion: Number(e.situacion),
          monto: Number(e.monto),
        }))
        .sort((a, b) => a.entidad.localeCompare(b.entidad));
    };

    const oldEntities = normalize(
      Array.isArray(oldStatus) ? oldStatus : oldStatus.entidades || [],
    );
    const newEntities = normalize(newStatus.entidades || []);

    return JSON.stringify(oldEntities) !== JSON.stringify(newEntities);
  }
}