import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import * as https from 'https';

@Injectable()
export class BcraService {
  private readonly logger = new Logger(BcraService.name);

  private httpsAgent = new https.Agent({
    keepAlive: false,
    maxSockets: 5,
    timeout: 30000,
    rejectUnauthorized: false
  });

  async fetchWithRetry(url: string, retries = 3, delay = 1000): Promise<any> {
    for (let i = 0; i <= retries; i++) {

      try {
        return await axios.get(url, 
          {
          httpsAgent: this.httpsAgent,
          timeout: 20000,
          headers: {
            'User-Agent': 'curl/8.5.0',
            'Accept': '*/*',
            'Connection': 'close'
          }
        }
      );
      } catch (err: any) {
        const status = err.response?.status;
        if (status === 404) throw err;

        const isRateLimit = status === 429;
        const isRetryable = !err.response || isRateLimit || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
        
        if (i === retries || !isRetryable) {
          this.logger.error(`Fallo final en ${url}  tras ${i} reintentos: ${err.message}`);
          throw err;
        }

        // Si es 429 (Too Many Requests), esperar más tiempo
        let waitTime = isRateLimit ? delay * 4 : delay;
        
        // Jitter: añadir variabilidad aleatoria (+/- 20%) para evitar sincronización
        const jitter = waitTime * 0.2 * (Math.random() * 2 - 1);
        waitTime = Math.max(100, waitTime + jitter);

        this.logger.warn(`Reintento ${i + 1}/${retries} en ${waitTime.toFixed(0)}ms: ${err.message}`);
        
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        delay *= 2;
      }
    }
  }

  async getFullReport(cuit: string) {
    const cuitLimpio = cuit.replace(/[-\s]/g, '');

    try {
      const [status, cheques] = await Promise.all([
        this.fetchBCRAStatus(cuitLimpio),
        this.fetchBCRACheques(cuitLimpio)
      ]);

      return { status, cheques };
    } catch (error) {
      this.logger.error(`Error en reporte completo CUIT ${cuit}: ${error.message}`);
      throw new ServiceUnavailableException('El BCRA está tardando demasiado en responder. Intente de nuevo en unos segundos.');
    }
  }

  async fetchBCRAStatus(cuitLimpio: string) {
    try {
      const response = await this.fetchWithRetry(`${process.env.API_URL_ENTIDADES}${cuitLimpio}`);
      return response?.data?.results?.periodos?.length ? response.data.results : null;
    } catch (error: any) {
      if (error.response?.status === 404) return null;
      throw error;
    }
  }

  async fetchBCRACheques(cuitLimpio: string) {
    try {
      const response = await this.fetchWithRetry(`${process.env.API_URL_CHEQUESRECHAZADOS}${cuitLimpio}`);
      return response?.data?.results || [];
    } catch (error: any) {
      // Un 404 en cheques significa que el CUIT no tiene cheques rechazados.
      if (error.response?.status === 404) return [];
      throw error;
    }
  }
}