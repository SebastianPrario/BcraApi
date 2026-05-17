import { Controller, Get, Param, NotFoundException, UseInterceptors, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BcraService } from './bcra.service';
import { CuitValidatorInterceptor } from './interceptors/cuit-validator.interceptor';
import { BcraExceptionFilter } from './filters/bcra-exception.filter';

@Controller('bcra')
@UseInterceptors(CuitValidatorInterceptor)
@UseFilters(BcraExceptionFilter)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class BcraController {
  constructor(private readonly bcraService: BcraService) {}

  @Get('status/:cuit')
  async getStatus(@Param('cuit') cuit: string) {
    return await this.bcraService.fetchBCRAStatus(cuit);
  }

  @Get('cheques/:cuit')
  async getCheques(@Param('cuit') cuit: string) {
    return await this.bcraService.fetchBCRACheques(cuit);
  }
}
