import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { BcraService } from './bcra.service';

@Controller('bcra')
export class BcraController {
  constructor(private readonly bcraService: BcraService) {}

  @Get('status/:cuit')
  async getStatus(@Param('cuit') cuit: string) {
    const status = await this.bcraService.fetchBCRAStatus(cuit);
    console.log(status);
    if (!status) {
      throw new NotFoundException(`No se encontró información para el CUIT: ${cuit}`);
    }
    return status;
  }

  @Get('cheques/:cuit')
  async getCheques(@Param('cuit') cuit: string) {
    const cheques = await this.bcraService.fetchBCRACheques(cuit);
    if (!cheques) {
      throw new NotFoundException(`No se encontró información de cheques para el CUIT: ${cuit}`);
    }
    return cheques;
  }
}
