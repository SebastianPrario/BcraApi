import { Module } from '@nestjs/common';
import { BcraService } from './bcra.service';
import { BcraController } from './bcra.controller';

@Module({
  providers: [BcraService],
  controllers: [BcraController],
  exports: [BcraService],
})
export class BcraModule {}
