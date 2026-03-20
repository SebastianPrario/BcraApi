import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { Alert } from './entities/alert.entity';
import { UserCuit } from '../users/entities/user-cuit.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Alert, UserCuit])],
  controllers: [AlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
