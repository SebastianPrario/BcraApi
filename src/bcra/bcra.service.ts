import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import * as https from 'https';

@Injectable()
export class BcraService {
  private readonly logger = new Logger(BcraService.name);
  
  // Cache simple en memoria: CUIT -> { data, timestamp }
  private cache = new Map<string, { data: any, timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  private httpsAgent = new https.Agent({ 
    keepAlive: false,
    timeout: 30000 
  });

  async fetchWithRetry(url: string, retries = 3, delay = 500): Promise<any> {
    for (let i = 0; i <= retries; i++) {
      try {
        return await axios.get(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept-Encoding': 'identity',
          },
          httpsAgent: this.httpsAgent,
          timeout: 20000,
        });
      } catch (err: any) {
        if (err.response?.status === 404) throw err;

        const isRetryable = !err.response || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
        if (i === retries || !isRetryable) throw err;

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }

  async getFullReport(cuit: string) {
    const cuitLimpio = cuit.replace(/[-\s]/g, '');
    
    // 1. Verificar Caché
    const cached = this.cache.get(cuitLimpio);
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.data;
    }

    try {
      // 2. Ejecutar ambas peticiones en paralelo
      const [status, cheques] = await Promise.all([
        this.fetchBCRAStatus(cuitLimpio),
        this.fetchBCRACheques(cuitLimpio)
      ]);

      const result = { status, cheques };
      
      // 3. Guardar en caché
      this.cache.set(cuitLimpio, { data: result, timestamp: Date.now() });
      
      return result;
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
      return response?.data?.results || null;
    } catch (error: any) {
      if (error.response?.status === 404) return null;
      throw error;
    }
  }
}