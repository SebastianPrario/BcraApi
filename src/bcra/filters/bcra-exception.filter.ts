import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class BcraExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(BcraExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorMessages = ['Ocurrió un error inesperado al procesar la solicitud.'];

    this.logger.error(`Exception on path: ${request.url} - Error: ${exception.message}`, exception.stack);

    if (exception.response?.status) {
      // Error de Axios (respuesta del BCRA)
      status = exception.response.status;
      const data = exception.response.data;
      
      if (data && data.errorMessages) {
        errorMessages = data.errorMessages;
      } else {
        errorMessages = [`El servidor del BCRA devolvió un error (Código ${status}).` ];
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : (res as any).message || exception.message;
      errorMessages = Array.isArray(message) ? message : [message];
    } else if (exception.code === 'ECONNRESET' || exception.code === 'ETIMEDOUT') {
      status = HttpStatus.GATEWAY_TIMEOUT;
      errorMessages = ['El servidor del BCRA no respondió a tiempo. Intente de nuevo en unos segundos.'];
    } else if (exception.request) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      errorMessages = ['No se pudo contactar con el BCRA. Verifique la conexión o intente más tarde.'];
    }

    // Aseguramos que el status de la respuesta HTTP sea un código válido
    const httpStatus = Number.isInteger(status) ? status : HttpStatus.INTERNAL_SERVER_ERROR;

    // El objeto retornado sigue la estructura analizada en la documentación:
    // status: 0 (para errores, según la doc del BCRA)
    // errorMessages: [lista de mensajes]
    response.status(httpStatus).json({
      status: 0,
      errorMessages: errorMessages,
    });
  }
}
