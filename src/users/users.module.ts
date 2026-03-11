import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { UserCuit } from './entities/user-cuit.entity';
import { UserAlertsService } from './user-alerts.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserCuit])],
  providers: [UsersService, UserAlertsService],
  controllers: [UsersController],
  exports: [UsersService, UserAlertsService],
})
export class UsersModule {}
